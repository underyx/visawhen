"""Post new numbers to a Discord channel: NVC's timeframes, and the N-400's
monthly numbers.

    python3 data/notify.py                         # compare the data files with the commit before HEAD, post what is new
    python3 data/notify.py --before <rev or dir>   # compare with another commit, or with a copy of data/
    python3 data/notify.py --dry-run               # print the messages and post nothing
    python3 data/notify.py --source nvc            # one source only: nvc or n400

The data workflows run this right after they commit what their scraper
found, so the commit before HEAD holds the data as it was before the run.
Each source posts one message when its newest reading or month is newer than
before, and nothing otherwise (the commit changed other data, or a fallback
only filled in older readings), so a change is posted once, by the run that
committed it:

* nvc (data/nvc/data.json, Monday afternoons): for each timeframe, the
  previous and the new number of days, with a circle for what the change
  means: red when the wait got 3 or more days longer, yellow when it got 1 or
  2 days longer, green when it got 3 or more days shorter and white
  otherwise. A timeframe NVC gave no new number for says so.
* n400 (data/uscis/monthly.json, about four weeks after each month): USCIS's
  average processing time, pending applications and approvals for the month,
  against the month before, coloured by the relative change: red when 5% or
  more worse (a longer time, more pending, fewer approvals), yellow when
  worse by less, green when 5% or more better, white otherwise. USCIS's
  quarterly report (data/uscis/forms.json) posts nothing: by the time it
  comes out, the monthly posts have covered its months.

Every title links to the page on visawhen.com and pings a role. The webhook
URL comes from the DISCORD_WEBHOOK_URL environment variable, a GitHub Actions
secret of the same name (Discord: the channel's settings, Integrations,
Webhooks, Copy Webhook URL). Without it, the messages are only printed and
the run ends green, so that forks and runs before the secret is set do not
fail. A post that Discord refuses fails the run: the data is committed by
then, so the site is still built and deployed, and the red run says the
webhook needs attention. The URL is never printed.

The roles come from DISCORD_ROLES, a GitHub Actions variable holding a JSON
object of role names to numeric role IDs, such as {"nvc-watch": "1558…",
"n400-watch": "1558…"} (Discord: Settings, Advanced, Developer Mode; then
Server Settings, Roles, the role's menu, Copy Role ID). A webhook cannot name
a role, only mention it by ID. Without the variable or the entry, nobody is
pinged, with a warning.

Only the standard library is used, so the workflows run this with the
runner's own Python.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parent
REPO = DATA.parent
WEBHOOK_ENV = "DISCORD_WEBHOOK_URL"
ROLES_ENV = "DISCORD_ROLES"
SITE = "https://visawhen.com"
TIMEOUT = 30
# Discord's rate limit answers with 429 and the seconds to wait; one retry is
# plenty for a few messages a month.
MAX_RETRY_AFTER = 30

# Between the old and the new number
ARROW = "\N{RIGHTWARDS ARROW}"
# What a change means for the wait: much worse, worse, much better, and
# anything else (the same, or a little better)
MUCH_WORSE = "\N{LARGE RED CIRCLE}"
WORSE = "\N{LARGE YELLOW CIRCLE}"
MUCH_BETTER = "\N{LARGE GREEN CIRCLE}"
SAME = "\N{MEDIUM WHITE CIRCLE}"
# NVC: a change of this many days is much worse or much better
NVC_MUCH_DAYS = 3
# N-400: a change of this share of the number before is much worse or much
# better
N400_MUCH_SHARE = 0.05


@dataclass(frozen=True)
class Message:
    # "New NVC numbers", "New N-400 numbers for August 2026"
    title: str
    # ("Document review", "🔴 56 → 62 days")
    lines: list[tuple[str, str]]


@dataclass(frozen=True)
class Source:
    name: str
    # The data file, relative to data/
    path: str
    # The DISCORD_ROLES entry to ping
    role: str
    # Where the title links
    page: str
    # The message for the new data, or None when it holds nothing newer
    build: Callable[[Any, Any], Message | None]


# ---------------------------------------------------------------------------
# Formatting


def format_count(value: Any) -> str:
    return f"{int(value):,}"


def format_months(value: Any) -> str:
    return f"{float(value):.1f}".removesuffix(".0")


def format_month(month: str) -> str:
    """"2026-08" as "August 2026"."""
    day = date.fromisoformat(f"{month}-01")
    return f"{day:%B} {day.year}"


def circle(worse_by: float, much: float) -> str:
    """The circle for a change, measured as how much worse it made things."""
    if worse_by >= much:
        return MUCH_WORSE
    if worse_by > 0:
        return WORSE
    if worse_by <= -much:
        return MUCH_BETTER
    return SAME


def compare(
    old: Any,
    new: Any,
    render: Callable[[Any], str],
    unit: str = "",
    worse_when_up: bool = True,
) -> str:
    """"🔴 778,489 → 813,453": a line for an N-400 number against the period
    before, coloured by the relative change."""
    if new is None:
        return f"{SAME} no number"
    if old is None or old == 0:
        return f"{SAME} {render(new)}{unit}"
    change = (new - old) / old
    worse_by = change if worse_when_up else -change
    return f"{circle(worse_by, N400_MUCH_SHARE)} {render(old)} {ARROW} {render(new)}{unit}"


# ---------------------------------------------------------------------------
# NVC

# In the order the site shows them: the series' key in data.json and its name
NVC_TIMEFRAMES = [
    ("review", "Document review"),
    ("creation", "Case creation"),
    ("inquiry", "Inquiry response"),
]


def newest_reading(series: dict[str, int]) -> tuple[str, int] | None:
    """A series' newest (as-of date, days), or None for an empty series."""
    if not series:
        return None
    as_of = max(series)
    return as_of, series[as_of]


def nvc_line(new: tuple[str, int] | None, old: tuple[str, int] | None) -> str:
    """"🔴 56 → 62 days", or what there is when a reading is missing."""
    if new is None:
        return f"{SAME} no update" if old is None else f"{SAME} {old[1]} days (no update)"
    days = new[1]
    unit = "day" if days == 1 else "days"
    if old is None:
        return f"{SAME} {days} {unit}"
    return f"{circle(days - old[1], NVC_MUCH_DAYS)} {old[1]} {ARROW} {days} {unit}"


def nvc_message(before: Any, after: Any) -> Message | None:
    """The newest reading of each timeframe against the newest before the
    run; None when no timeframe has a newer one."""
    changed = False
    lines = []
    for key, label in NVC_TIMEFRAMES:
        new = newest_reading(after.get(key, {}))
        old = newest_reading(before.get(key, {}))
        if new is not None and (old is None or new[0] > old[0]):
            changed = True
            lines.append((label, nvc_line(new, old)))
        else:
            # nothing new: the newest reading stands
            lines.append((label, nvc_line(None, new)))
    return Message("New NVC numbers", lines) if changed else None


# ---------------------------------------------------------------------------
# N-400

N400 = "N-400"


def n400_months(data: Any) -> list[str]:
    """The months with an N-400 row, oldest first."""
    months = data.get("months", {})
    return sorted(month for month in months if N400 in months[month].get("forms", {}))


def n400_month_row(data: Any, month: str) -> dict[str, Any]:
    """The month's N-400 row: USCIS's monthly report has one for the whole form."""
    rows = data["months"][month]["forms"][N400]
    return rows.get("all") or next(iter(rows.values()))


def n400_message(before: Any, after: Any) -> Message | None:
    """The newest month's numbers against the month before it; None when the
    newest month is not new."""
    months = n400_months(after)
    old_months = n400_months(before)
    if not months or (old_months and months[-1] <= old_months[-1]):
        return None
    new = n400_month_row(after, months[-1])
    old = n400_month_row(after, months[-2]) if len(months) > 1 else {}
    return Message(
        f"New {N400} numbers for {format_month(months[-1])}",
        [
            ("Processing time", compare(old.get("averageMonths"), new.get("averageMonths"), format_months, " months")),
            ("Pending applications", compare(old.get("pending"), new.get("pending"), format_count)),
            ("Approved", compare(old.get("approved"), new.get("approved"), format_count, worse_when_up=False)),
        ],
    )


SOURCES = [
    Source("nvc", "nvc/data.json", "nvc-watch", f"{SITE}/nvc", nvc_message),
    Source("n400", "uscis/monthly.json", "n400-watch", f"{SITE}/uscis/n-400", n400_message),
]


# ---------------------------------------------------------------------------
# Loading, rendering and posting


def load_before(before: str, path: str) -> Any:
    """A data file as it was: from a copy of data/, or at a git revision."""
    directory = Path(before)
    if directory.is_dir():
        with (directory / path).open() as data_file:
            return json.load(data_file)
    result = subprocess.run(
        ["git", "show", f"{before}:data/{path}"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        sys.exit(f"ERROR: git show {before}:data/{path} failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def load_after(path: str) -> Any:
    with (DATA / path).open() as data_file:
        return json.load(data_file)


def roles(roles_json: str) -> dict[str, str]:
    """The DISCORD_ROLES object, role names to IDs; empty, with a warning,
    when it is unset or unusable."""
    if not roles_json.strip():
        print(f"::warning::{ROLES_ENV} is not set, so no role is pinged")
        return {}
    try:
        parsed = json.loads(roles_json)
    except ValueError:
        print(f"::warning::{ROLES_ENV} is not valid JSON, so no role is pinged")
        return {}
    if not isinstance(parsed, dict):
        print(f"::warning::{ROLES_ENV} is not a JSON object, so no role is pinged")
        return {}
    return {name: str(role_id) for name, role_id in parsed.items()}


def role_to_ping(known: dict[str, str], name: str) -> str | None:
    """The ID of a role, or None (with a warning) when the map lacks it."""
    role_id = known.get(name)
    if role_id is None or not role_id.isdigit():
        if known:
            print(f'::warning::{ROLES_ENV} has no "{name}" entry with a role ID (a number), so no role is pinged')
        return None
    return role_id


def render(message: Message, page: str, role_id: str | None) -> str:
    # The URL in angle brackets, so that Discord adds no preview card
    title = f"[{message.title}](<{page}>)"
    if role_id is not None:
        title += f" <@&{role_id}>"
    parts = [title]
    for label, line in message.lines:
        parts += ["", label, line]
    return "\n".join(parts)


def post(webhook_url: str, content: str, role_id: str | None) -> bool:
    """POST the message to the webhook; whether Discord accepted it. Prints
    what went wrong without the URL, which is a secret."""
    payload = {
        "content": content,
        # Only that role can be pinged, whatever else the text says
        "allowed_mentions": {"parse": [], "roles": [] if role_id is None else [role_id]},
    }
    # wait=true makes Discord answer 200 with the message instead of 204 on
    # success, so that a refused message is told apart
    request = urllib.request.Request(
        f"{webhook_url}?wait=true",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "visawhen-bot (+https://github.com/underyx/visawhen)"},
        method="POST",
    )
    for attempt in range(2):
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                status = response.status
                body = response.read().decode(errors="replace")
        except urllib.error.HTTPError as error:
            status = error.code
            body = error.read().decode(errors="replace")
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            print(f"The request to Discord failed: {type(error).__name__}", file=sys.stderr)
            return False
        if status == 429 and attempt == 0:
            try:
                retry_after = float(json.loads(body).get("retry_after", 1))
            except (ValueError, AttributeError):
                retry_after = 1.0
            retry_after = min(max(retry_after, 1.0), MAX_RETRY_AFTER)
            print(f"Discord asked to wait {retry_after:.0f}s (rate limit); retrying once")
            time.sleep(retry_after)
            continue
        break
    if status != 200:
        print(f"Discord answered HTTP {status}: {body[:500]}", file=sys.stderr)
        return False
    print("Posted to Discord")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--before",
        default="HEAD~1",
        metavar="REV_OR_DIR",
        help="the data to compare with: a git revision (default: HEAD~1) or a directory laid out like data/",
    )
    parser.add_argument(
        "--source",
        action="append",
        choices=[source.name for source in SOURCES],
        help="only this source (repeatable); default: all",
    )
    parser.add_argument("--dry-run", action="store_true", help="print the messages and do not post them")
    args = parser.parse_args()

    known_roles = roles(os.environ.get(ROLES_ENV, ""))
    webhook_url = os.environ.get(WEBHOOK_ENV, "")
    failed = False
    posted = 0
    for source in SOURCES:
        if args.source and source.name not in args.source:
            continue
        message = source.build(load_before(args.before, source.path), load_after(source.path))
        if message is None:
            print(f"{source.name}: nothing newer than before")
            continue
        role_id = role_to_ping(known_roles, source.role)
        content = render(message, source.page, role_id)
        print(f"{source.name}:\n{content}\n")
        if args.dry_run:
            continue
        if not webhook_url:
            print(f"::notice::{WEBHOOK_ENV} is not set, so the message above was not posted to Discord")
            continue
        if post(webhook_url, content, role_id):
            posted += 1
        else:
            failed = True
    if posted:
        print(f"Posted {posted} message{'s' if posted != 1 else ''}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
