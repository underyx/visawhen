"""Post NVC's new timeframes to a Discord channel, with how each one changed.

    uv run python notify.py                         # compare data.json with the commit before HEAD, then post
    uv run python notify.py --before <rev or file>  # compare with another commit, or with a saved copy
    uv run python notify.py --dry-run               # print the message and post nothing

The NVC workflow runs this right after it commits what main.py found, so the
commit before HEAD holds data.json as it was before the run. For each
timeframe (document review, case creation, inquiry response) the message
gives the newest number of days, how it changed since NVC's previous reading
and the submission date NVC has reached; a timeframe NVC gave no new number
for says so. Nothing is posted when no timeframe has a newer reading than
before: the commit only changed the interview-queue data, or the Wayback
Machine only filled in older readings.

The webhook URL comes from the DISCORD_NVC_WEBHOOK_URL environment variable,
a GitHub Actions secret of the same name (Discord: the channel's settings,
Integrations, Webhooks, Copy Webhook URL). Without it, the message is only
printed and the run ends green, so that forks and runs before the secret is
set do not fail. A post that Discord refuses fails the run: the data is
committed by then, so the site is still built and deployed, and the red run
says the webhook needs attention. The URL is never printed.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import date
from datetime import timedelta
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
PAGE_URL = "https://visawhen.com/nvc"
SOURCE = "NVC's timeframes page on travel.state.gov"
# The violet of the site's links and stamp (pages/_app.tsx, shade 7)
COLOR = 0x6C47AA
TIMEOUT = 30
# Discord's rate limit answers with 429 and the seconds to wait; one retry is
# plenty for a message a week.
MAX_RETRY_AFTER = 30

# In the order the site shows them: the series' key in data.json, its name,
# and what NVC is doing to the submissions of the date it has reached.
TIMEFRAMES: list[tuple[TimeframeName, str, str]] = [
    ("review", "Document review", "Reviewing documents submitted on {date}"),
    ("creation", "Case creation", "Creating cases received from USCIS on {date}"),
    ("inquiry", "Inquiry response", "Answering inquiries received on {date}"),
]


def format_date(iso: str) -> str:
    """"October 5, 2026", as the site writes dates."""
    day = date.fromisoformat(iso)
    return f"{day:%B} {day.day}, {day.year}"


def newest(series: dict[str, int]) -> Reading | None:
    """A series' newest reading, or None for an empty series."""
    if not series:
        return None
    as_of = max(series)
    return as_of, series[as_of]


def front(reading: Reading) -> str:
    """The submission date NVC had reached on a reading, in ISO format."""
    as_of, days = reading
    return (date.fromisoformat(as_of) - timedelta(days=days)).isoformat()


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
    for name, _title, _phrase in TIMEFRAMES:
        new = newest(after.get(name, {}))
        old = newest(before.get(name, {}))
        if new is not None and (old is None or new[0] > old[0]):
            changes[name] = new
    return changes


def describe_change(new: Reading, old: Reading | None, note_date: bool) -> str:
    """"**62 days** · was 56 (+6)", or just the days when there is nothing older."""
    days = new[1]
    text = f"**{days} day{'' if days == 1 else 's'}**"
    if old is None:
        return text
    old_days = old[1]
    was = f"was {old_days}"
    if note_date:
        was += f" on {format_date(old[0])}"
    change = "no change" if days == old_days else f"{days - old_days:+d}"
    return f"{text} · {was} ({change})"


def build_message(before: Data, after: Data) -> dict[str, Any] | None:
    """The webhook payload, or None when no series has a newer reading."""
    changes = changed_series(before, after)
    if not changes:
        return None

    as_of_dates = {as_of for as_of, _days in changes.values()}
    previous = {
        old[0] for name in changes if (old := newest(before.get(name, {}))) is not None
    }
    # Each series has its own date: the scraper matches NVC's three sentences
    # separately. When they agree, the title and description carry the dates;
    # otherwise each timeframe names its own.
    same_as_of = len(as_of_dates) == 1
    same_previous = len(previous) == 1

    title = (
        f"NVC wait times as of {format_date(max(as_of_dates))}"
        if same_as_of
        else "NVC updated its wait times"
    )
    description = (
        f"Changes are since NVC's previous update on {format_date(max(previous))}. "
        if same_previous
        else ""
    ) + f"Charts and estimates: [visawhen.com/nvc]({PAGE_URL})"

    fields = []
    for name, field_title, phrase in TIMEFRAMES:
        new = changes.get(name)
        if new is None:
            last = newest(after.get(name, {}))
            value = (
                "No new number from NVC."
                if last is None
                else f"No new number from NVC. The last one was **{last[1]} days** on {format_date(last[0])}."
            )
        else:
            old = newest(before.get(name, {}))
            first_line = describe_change(new, old, note_date=not same_previous)
            if not same_as_of:
                first_line += f" · as of {format_date(new[0])}"
            second_line = phrase.format(date=format_date(front(new)))
            if old is not None:
                second_line += f" (was {format_date(front(old))})"
            value = f"{first_line}\n{second_line}"
        fields.append({"name": field_title, "value": value, "inline": False})

    return {
        "embeds": [
            {
                "title": title,
                "url": PAGE_URL,
                "description": description,
                "color": COLOR,
                "fields": fields,
                "footer": {"text": f"Source: {SOURCE}"},
            }
        ]
    }


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

    before = load_before(args.before)
    after = load_data(DATA_PATH)
    payload = build_message(before, after)
    if payload is None:
        print("No timeframe has a newer reading than before; nothing to post")
        return 0

    print(json.dumps(payload, indent=2, ensure_ascii=False))
    if args.dry_run:
        return 0
    webhook_url = os.environ.get(WEBHOOK_ENV, "")
    if not webhook_url:
        print(f"::notice::{WEBHOOK_ENV} is not set, so the message above was not posted to Discord")
        return 0
    return 0 if post(webhook_url, payload) else 1


if __name__ == "__main__":
    sys.exit(main())
