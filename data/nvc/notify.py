"""Post NVC's new timeframes to a Discord channel, with how each one changed.

    uv run python notify.py                         # compare data.json with the commit before HEAD, then post
    uv run python notify.py --before <rev or file>  # compare with another commit, or with a saved copy
    uv run python notify.py --dry-run               # print the message and post nothing

The NVC workflow runs this right after it commits what main.py found, so the
commit before HEAD holds data.json as it was before the run. The message
gives, for each timeframe (document review, case creation, inquiry
response), the previous and the new number of days, with a circle for what
the change means: red when the wait got 3 or more days longer, yellow when it
got 1 or 2 days longer, green when it got 3 or more days shorter and white
otherwise; a timeframe NVC gave no new number for says so. The title links
to visawhen.com/nvc and pings a role. Nothing is posted when no timeframe
has a newer reading than before: the commit only changed the interview-queue
data, or the Wayback Machine only filled in older readings.

The webhook URL comes from the DISCORD_NVC_WEBHOOK_URL environment variable,
a GitHub Actions secret of the same name (Discord: the channel's settings,
Integrations, Webhooks, Copy Webhook URL). Without it, the message is only
printed and the run ends green, so that forks and runs before the secret is
set do not fail. A post that Discord refuses fails the run: the data is
committed by then, so the site is still built and deployed, and the red run
says the webhook needs attention. The URL is never printed.

The role to ping is the "nvc-watch" entry of DISCORD_ROLES, a GitHub Actions
variable holding a JSON object of role names to numeric role IDs, such as
{"nvc-watch": "1558910798469013635", "n400-watch": "..."} (Discord: Settings,
Advanced, Developer Mode; then Server Settings, Roles, the role's menu, Copy
Role ID). A webhook cannot name a role, only mention it by ID. Without the
variable or the entry, nobody is pinged, with a warning.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from typing import Literal

import requests

TimeframeName = Literal["creation", "review", "inquiry"]
Data = dict[TimeframeName, dict[str, int]]
# (as_of date in ISO format, number of days of backlog), as in main.py
Reading = tuple[str, int]

DATA_PATH = Path(os.environ.get("NVC_DATA_PATH", "data.json"))
WEBHOOK_ENV = "DISCORD_NVC_WEBHOOK_URL"
ROLES_ENV = "DISCORD_ROLES"
ROLE_NAME = "nvc-watch"
# In angle brackets so that Discord adds no preview card under the message
PAGE_URL = "https://visawhen.com/nvc"
TIMEOUT = 30
# Discord's rate limit answers with 429 and the seconds to wait; one retry is
# plenty for a message a week.
MAX_RETRY_AFTER = 30

TITLE = "New NVC numbers"
# What the change means for the wait: 3 or more days longer, 1 or 2 days
# longer, 3 or more days shorter, and anything else (the same, or 1 or 2 days
# shorter)
MUCH_LONGER = "\N{LARGE RED CIRCLE}"
LONGER = "\N{LARGE YELLOW CIRCLE}"
MUCH_SHORTER = "\N{LARGE GREEN CIRCLE}"
SAME = "\N{MEDIUM WHITE CIRCLE}"
MUCH_DAYS = 3

# In the order the site shows them: the series' key in data.json and its name
TIMEFRAMES: list[tuple[TimeframeName, str]] = [
    ("review", "Document review"),
    ("creation", "Case creation"),
    ("inquiry", "Inquiry response"),
]


def newest(series: dict[str, int]) -> Reading | None:
    """A series' newest reading, or None for an empty series."""
    if not series:
        return None
    as_of = max(series)
    return as_of, series[as_of]


def load_data(path: Path) -> Data:
    with path.open() as data_file:
        data: Data = json.load(data_file)
    return data


def load_before(before: str) -> Data:
    """data.json as it was: a saved copy, or the file at a git revision."""
    path = Path(before)
    if path.is_file():
        return load_data(path)
    result = subprocess.run(
        ["git", "show", f"{before}:./{DATA_PATH.name}"],
        cwd=DATA_PATH.parent,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        sys.exit(f"ERROR: git show {before}:./{DATA_PATH.name} failed: {result.stderr.strip()}")
    data: Data = json.loads(result.stdout)
    return data


def changed_series(before: Data, after: Data) -> dict[TimeframeName, Reading]:
    """The newest reading of each series that has one newer than before."""
    changes: dict[TimeframeName, Reading] = {}
    for name, _title in TIMEFRAMES:
        new = newest(after.get(name, {}))
        old = newest(before.get(name, {}))
        if new is not None and (old is None or new[0] > old[0]):
            changes[name] = new
    return changes


def describe(new: Reading | None, old: Reading | None) -> str:
    """"🔴 56 -> 62 days", or what there is when a reading is missing."""
    if new is None:
        return f"{SAME} no update" if old is None else f"{SAME} {old[1]} days (no update)"
    days = new[1]
    unit = "day" if days == 1 else "days"
    if old is None:
        return f"{SAME} {days} {unit}"
    change = days - old[1]
    if change >= MUCH_DAYS:
        circle = MUCH_LONGER
    elif change > 0:
        circle = LONGER
    elif change <= -MUCH_DAYS:
        circle = MUCH_SHORTER
    else:
        circle = SAME
    return f"{circle} {old[1]} -> {days} {unit}"


def role_to_ping(roles_json: str) -> str | None:
    """The ID of the ROLE_NAME role in the DISCORD_ROLES JSON object, or None
    (with a warning when the variable is set but unusable)."""
    if not roles_json.strip():
        print(f"::warning::{ROLES_ENV} is not set, so no role is pinged")
        return None
    try:
        roles = json.loads(roles_json)
    except ValueError:
        print(f"::warning::{ROLES_ENV} is not valid JSON, so no role is pinged")
        return None
    role_id = roles.get(ROLE_NAME) if isinstance(roles, dict) else None
    if isinstance(role_id, int):
        role_id = str(role_id)
    if not isinstance(role_id, str) or not role_id.isdigit():
        print(
            f'::warning::{ROLES_ENV} has no "{ROLE_NAME}" entry with a role ID (a number as a string), '
            "so no role is pinged"
        )
        return None
    return role_id


def build_message(before: Data, after: Data, role_id: str | None) -> str | None:
    """The message, or None when no series has a newer reading."""
    changes = changed_series(before, after)
    if not changes:
        return None
    title = f"[{TITLE}](<{PAGE_URL}>)"
    if role_id is not None:
        title += f" <@&{role_id}>"
    lines = [title]
    for name, title in TIMEFRAMES:
        new = changes.get(name)
        old = newest(before.get(name, {}))
        # a series with nothing new keeps its newest reading, which is "old"
        lines += ["", title, describe(new, old if new is not None else newest(after.get(name, {})))]
    return "\n".join(lines)


def post(webhook_url: str, payload: dict[str, Any]) -> bool:
    """POST the payload to the webhook; whether Discord accepted it. Prints
    what went wrong without the URL, which is a secret."""
    for attempt in range(2):
        try:
            # wait=true makes Discord answer 200 with the message instead of
            # 204 on success, so that a refused message is told apart
            response = requests.post(
                webhook_url, params={"wait": "true"}, json=payload, timeout=TIMEOUT
            )
        except requests.RequestException as error:
            print(f"The request to Discord failed: {type(error).__name__}", file=sys.stderr)
            return False
        if response.status_code == 429 and attempt == 0:
            try:
                retry_after = float(response.json().get("retry_after", 1))
            except ValueError:
                retry_after = 1.0
            retry_after = min(max(retry_after, 1.0), MAX_RETRY_AFTER)
            print(f"Discord asked to wait {retry_after:.0f}s (rate limit); retrying once")
            time.sleep(retry_after)
            continue
        break
    if response.status_code != 200:
        print(
            f"Discord answered HTTP {response.status_code}: {response.text[:500]}",
            file=sys.stderr,
        )
        return False
    print("Posted to Discord")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--before",
        default="HEAD~1",
        metavar="REV_OR_FILE",
        help="the data to compare with: a git revision of data.json (default: HEAD~1) or a copy of it",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="print the message and do not post it"
    )
    args = parser.parse_args()

    role_id = role_to_ping(os.environ.get(ROLES_ENV, ""))

    before = load_before(args.before)
    after = load_data(DATA_PATH)
    message = build_message(before, after, role_id)
    if message is None:
        print("No timeframe has a newer reading than before; nothing to post")
        return 0

    print(message)
    if args.dry_run:
        return 0
    webhook_url = os.environ.get(WEBHOOK_ENV, "")
    if not webhook_url:
        print(f"::notice::{WEBHOOK_ENV} is not set, so the message above was not posted to Discord")
        return 0
    # Only that role can be pinged, whatever else the text says
    payload = {
        "content": message,
        "allowed_mentions": {"parse": [], "roles": [] if role_id is None else [role_id]},
    }
    return 0 if post(webhook_url, payload) else 1


if __name__ == "__main__":
    sys.exit(main())
