"""Check how old each data source's newest data is, and keep one GitHub issue
open per source whose data has gone stale.

    python3 data/freshness.py                # report only
    python3 data/freshness.py --github       # also open, update and close the issues

The scheduled scrapers treat "the source is unreachable" and "nothing new yet"
alike (a warning, and a green run), so a scraper that silently stops finding
data would otherwise go unnoticed for months. This compares each source's
newest date with how often the source publishes:

* NVC timeframes (data/nvc/data.json): NVC updates its page weekly; stale 14
  days after the newest reading.
* Interview queues (data/consulates/iv_schedule.json): State updates its IV
  Scheduling Status Tool about monthly; stale once the newest snapshot is more
  than 45 days old, when the consulate pages start warning about it too
  (IvScheduleCard's MAX_AGE_DAYS).
* USCIS forms (data/uscis/forms.json): USCIS publishes each quarter a few
  months after it ends; stale 120 days after the end of the quarter after the
  newest one.
* Visa Bulletins (data/visa_bulletin/data.json): State publishes each
  month's bulletin around the middle of the month before; stale 8 days into
  a month with no bulletin for it, when the Visa Bulletin pages start
  warning about it too (GRACE_DAYS in pages/visa-bulletin/).
* Consulate issuances (data/consulates/dump/backlogs.ndjson.gz): State
  publishes its monthly issuance statistics several months late, often in
  batches; stale 240 days after the end of the newest month.

With --github, a stale source gets an issue labelled "stale-data", titled
"Stale data: <source>", whose text is updated on every run (an edit, which
notifies no one), and the issue is closed with a comment once the source has
new data. It uses the gh CLI, which needs GH_TOKEN with issues: write.

Only the standard library is used, so the workflow runs this with the
runner's own Python.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC
from datetime import date
from datetime import datetime
from datetime import timedelta
from pathlib import Path

DATA = Path(__file__).parent
# Links in the issues are absolute, so that they also work in notifications
REPOSITORY_URL = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ.get('GITHUB_REPOSITORY', 'underyx/visawhen')}"
LABEL = "stale-data"
TITLE_PREFIX = "Stale data: "


@dataclass(frozen=True)
class Freshness:
    # The source's name, as it appears in the issue's title
    source: str
    # Its newest data: "2026-07-13", or its newest month or quarter
    newest: str
    # The day from which the data counts as stale
    stale_from: date
    # How often the source publishes, as a sentence
    cadence: str
    # Where to look when it is stale, as Markdown
    where: str


def end_of_month(year: int, month: int) -> date:
    return date(year + month // 12, month % 12 + 1, 1) - timedelta(days=1)


def nvc() -> Freshness:
    data = json.loads((DATA / "nvc" / "data.json").read_text())
    newest = max(day for timeframe in data.values() for day in timeframe)
    return Freshness(
        source="NVC timeframes",
        newest=newest,
        stale_from=date.fromisoformat(newest) + timedelta(days=14),
        cadence="NVC updates its timeframes page weekly, so the data counts as stale 14 days after its newest reading.",
        where=(
            "The scraper is `data/nvc/main.py`, run by the "
            f"[Update NVC and interview-queue data]({REPOSITORY_URL}/actions/workflows/nvc_update_schedule.yml) workflow. Its log says which sources "
            "answered (travel.state.gov, the adoption.state.gov mirror, the Wayback Machine) and what date each "
            "page is as of. Compare with [NVC's page](https://travel.state.gov/content/travel/en/us-visas/"
            "immigrate/nvc-timeframes.html)."
        ),
    )


def iv_schedule() -> Freshness:
    data = json.loads((DATA / "consulates" / "iv_schedule.json").read_text())
    newest = max(data["snapshots"])
    return Freshness(
        source="interview queues (IV Scheduling Status Tool)",
        newest=newest,
        # the day it is more than 45 days old, as in IvScheduleCard
        stale_from=date.fromisoformat(newest) + timedelta(days=46),
        cadence=(
            "State updates its IV Scheduling Status Tool about monthly, so the data counts as stale once the "
            "newest snapshot is more than 45 days old; the consulate pages warn about it from then on too."
        ),
        where=(
            "The scraper is `data/consulates/iv_schedule.py --fetch`, run by the "
            f"[Update NVC and interview-queue data]({REPOSITORY_URL}/actions/workflows/nvc_update_schedule.yml) workflow. If the "
            "[tool](https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/iv-wait-times.html) "
            "has a newer update, the log says why it was not added; the page can also be saved from a browser and "
            "added with `iv_schedule.py --from-file`."
        ),
    )


def uscis_forms() -> Freshness:
    periods = json.loads((DATA / "uscis" / "forms.json").read_text())["periods"]
    newest = periods[-1]
    newest_end = date.fromisoformat(newest["end"])
    next_end = end_of_month(newest_end.year, newest_end.month + 3)
    return Freshness(
        source="USCIS forms",
        newest=f"FY{newest['fiscalYear']} Q{newest['fiscalQuarter']} (ended {newest['end']})",
        stale_from=next_end + timedelta(days=120),
        cadence=(
            "USCIS publishes each quarter's reports a few months after the quarter ends, so the data counts as "
            f"stale 120 days after the next quarter ended on {next_end.isoformat()}."
        ),
        where=(
            "The scraper is `data/uscis/forms.py`, run by the "
            f"[Update USCIS forms data]({REPOSITORY_URL}/actions/workflows/uscis_forms_update_schedule.yml) workflow. Check "
            "whether USCIS's [Immigration and Citizenship Data](https://www.uscis.gov/tools/reports-and-studies/"
            "immigration-and-citizenship-data) page lists the next quarter; if it does, the workflow's log says "
            "why it was not added."
        ),
    )


def visa_bulletin() -> Freshness:
    bulletins = json.loads((DATA / "visa_bulletin" / "data.json").read_text())["bulletins"]
    newest = max(bulletins)
    year, month = int(newest[:4]), int(newest[5:7])
    # the first day of the month after the newest bulletin's
    due = end_of_month(year, month) + timedelta(days=1)
    return Freshness(
        source="Visa Bulletins",
        newest=newest,
        # more than 7 days into that month, as on the Visa Bulletin pages
        stale_from=due + timedelta(days=8),
        cadence=(
            "State publishes each month's Visa Bulletin around the middle of the month before, so the data counts "
            f"as stale once {due.isoformat()} is more than 7 days past without the bulletin for that month; the "
            "Visa Bulletin pages warn about it from then on too."
        ),
        where=(
            "The scraper is `data/visa_bulletin/bulletin.py`, run by the "
            f"[Update Visa Bulletin data]({REPOSITORY_URL}/actions/workflows/visa_bulletin_update_schedule.yml) workflow. "
            "If State's [Visa Bulletin page](https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html) "
            "lists a newer bulletin, the log says why it was not added; the page can also be saved from a browser and "
            "added with `bulletin.py --from-file`."
        ),
    )


def consulate_issuances() -> Freshness:
    with gzip.open(DATA / "consulates" / "dump" / "backlogs.ndjson.gz", "rt") as dump:
        # rows are [post slug, visa class slug, month "2025-09-01 00:00:00", ...]
        newest = max(json.loads(line)[2] for line in dump if line.strip())
    year, month = int(newest[:4]), int(newest[5:7])
    return Freshness(
        source="consulate issuances",
        newest=newest[:7],
        stale_from=end_of_month(year, month) + timedelta(days=240),
        cadence=(
            "State publishes its monthly visa issuance statistics several months late, often a few months at a "
            "time (October 2025 to February 2026 all appeared between July and September 2026), so the data counts "
            "as stale 240 days after the end of the newest month."
        ),
        where=(
            "The scrapers are the notebooks in `data/consulates/`, run by the "
            f"[Update consulates data]({REPOSITORY_URL}/actions/workflows/consulate_update_schedule.yml) workflow. Check whether "
            "State's [monthly immigrant visa issuance statistics](https://travel.state.gov/content/travel/en/legal/"
            "visa-law0/visa-statistics/immigrant-visa-statistics/monthly-immigrant-visa-issuances.html) list a "
            "newer month; if they do, the workflow's log says why it was not added."
        ),
    )


CHECKS: list[Callable[[], Freshness]] = [nvc, iv_schedule, uscis_forms, visa_bulletin, consulate_issuances]


def issue_body(freshness: Freshness, today: date, run_url: str | None) -> str:
    stale_days = (today - freshness.stale_from).days
    since = "today" if stale_days == 0 else f"{stale_days} {'day' if stale_days == 1 else 'days'} ago"
    checked = f"[the freshness workflow]({run_url})" if run_url else "the freshness workflow"
    return "\n\n".join(
        [
            f"The newest {freshness.source} data is from **{freshness.newest}**. It became stale on "
            f"{freshness.stale_from.isoformat()}, {since}.",
            freshness.cadence,
            freshness.where,
            f"Last checked {today.isoformat()} by {checked} (`data/freshness.py`). It updates this issue while the "
            "data stays stale and closes it when newer data arrives.",
        ]
    )


def gh(*args: str) -> str:
    result = subprocess.run(["gh", *args], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        sys.exit(f"gh {args[0]} {args[1]} failed: {result.stderr.strip()}")
    return result.stdout


def sync_issues(results: list[tuple[Freshness, bool]], today: date, run_url: str | None) -> None:
    """Open, update or close one issue per source."""
    gh(
        "label",
        "create",
        LABEL,
        "--force",
        "--color",
        "d93f0b",
        "--description",
        "A data source has had no new data for longer than it should",
    )
    open_issues = {
        issue["title"]: issue["number"]
        for issue in json.loads(
            gh("issue", "list", "--label", LABEL, "--state", "open", "--limit", "100", "--json", "number,title")
        )
    }
    for freshness, stale in results:
        title = f"{TITLE_PREFIX}{freshness.source}"
        number = open_issues.get(title)
        if stale:
            body = issue_body(freshness, today, run_url)
            if number is None:
                print(f"Opening an issue: {title}")
                gh("issue", "create", "--title", title, "--label", LABEL, "--body", body)
            else:
                print(f"Updating issue #{number}: {title}")
                gh("issue", "edit", str(number), "--body", body)
        elif number is not None:
            print(f"Closing issue #{number}: {title}")
            gh(
                "issue",
                "close",
                str(number),
                "--comment",
                f"New data arrived: the newest {freshness.source} data is now from {freshness.newest}.",
            )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--github", action="store_true", help="open, update and close the stale-data issues")
    parser.add_argument("--today", type=date.fromisoformat, help="check as of this day (default: today, UTC)")
    args = parser.parse_args()
    today: date = args.today or datetime.now(UTC).date()

    results = []
    for check in CHECKS:
        freshness = check()
        stale = today >= freshness.stale_from
        results.append((freshness, stale))
        print(
            f"{freshness.source}: newest {freshness.newest}, "
            f"{'STALE since' if stale else 'stale from'} {freshness.stale_from.isoformat()}"
        )
        if stale:
            print(f"::warning::{freshness.source} data is stale: the newest is {freshness.newest}")

    if args.github:
        run_id = os.environ.get("GITHUB_RUN_ID")
        run_url = f"{REPOSITORY_URL}/actions/runs/{run_id}" if run_id else None
        sync_issues(results, today, run_url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
