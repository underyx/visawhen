"""Scrape NVC processing time frames into data.json.

Sources, in order:

1. The live page on travel.state.gov. It sits behind Cloudflare, which
   frequently answers with a 403 challenge page for non-browser clients.
2. The Wayback Machine, as a fallback whenever the live page is unusable.
   Captures are dated by their own content ("As of 6-Jul-26"), so a stale
   capture can never insert wrong data: the as_of date is the key.

Exit codes: 0 when new data was added or when every source is simply
unavailable/stale (a ``::warning::`` annotation is printed in the latter
case, so the workflow's commit step just finds nothing to commit); 1 when
the live page was served but no longer matches our regexes, or on any
other error.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Literal

import arrow
import requests

TimeframeName = Literal["creation", "review", "inquiry"]
Data = dict[TimeframeName, dict[str, int]]
# per timeframe: (as_of date in ISO format, number of days of backlog)
Parsed = dict[TimeframeName, tuple[str, int]]

PAGE_URL = "https://travel.state.gov/content/travel/en/us-visas/immigrate/nvc-timeframes.html"
CDX_URL = "https://web.archive.org/cdx/search/cdx"
WAYBACK_URL = "https://web.archive.org/web/{timestamp}id_/{url}"
DATA_PATH = Path(os.environ.get("NVC_DATA_PATH", "data.json"))
TIMEOUT = 60
WAYBACK_ATTEMPTS = 3

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

PATTERNS: dict[TimeframeName, re.Pattern[str]] = {
    "creation": re.compile(
        r"Current case creation time frame: As of (?P<as_of_date>\d+-\w+-\d+), we are working on cases that were received from USCIS on (?P<latest_date>\d+-\w+-\d+)."
    ),
    "review": re.compile(
        r"Current case review time: As of (?P<as_of_date>\d+-\w+-\d+), we are reviewing documents submitted to us on (?P<latest_date>\d+-\w+-\d+)."
    ),
    "inquiry": re.compile(
        r"As of (?P<as_of_date>\d+-\w+-\d+), we are responding to inquiries received on (?P<latest_date>\d+-\w+-\d+)."
    ),
}
DATE_FORMATS = [
    "D-MMM-YYYY",
    "D-MMMM-YYYY",
    "D-MMM-YY",
    "D-MMMM-YY",
    "DD-MMM-YYYY",
    "DD-MMMM-YYYY",
    "DD-MMM-YY",
    "DD-MMMM-YY",
]


def parse_page(html: str) -> Parsed:
    """Extract (as_of_date, backlog_days) per timeframe; timeframes that don't match are omitted."""
    text = html.replace("&nbsp;", " ").replace("\xa0", " ")
    parsed: Parsed = {}
    for timeframe_name, pattern in PATTERNS.items():
        match = pattern.search(text)
        if not match:
            continue
        as_of_date = arrow.get(match.group("as_of_date"), DATE_FORMATS)
        latest_date = arrow.get(match.group("latest_date"), DATE_FORMATS)
        parsed[timeframe_name] = (
            as_of_date.date().isoformat(),
            (as_of_date - latest_date).days,
        )
    return parsed


def merge(data: Data, parsed: Parsed, source: str) -> bool:
    """Add as_of dates we haven't seen yet to data; return whether anything was added."""
    changed = False
    for timeframe_name, (as_of_date, days) in parsed.items():
        if as_of_date in data[timeframe_name]:
            continue
        data[timeframe_name][as_of_date] = days
        changed = True
        print(f"+ {timeframe_name} {as_of_date}: {days} days ({source})")
    return changed


def latest_as_of(data: Data) -> str:
    return max(date for timeframe in data.values() for date in timeframe)


def describe(parsed: Parsed) -> str:
    return ", ".join(sorted({as_of_date for as_of_date, _days in parsed.values()}))


def fetch_live(session: requests.Session) -> str | None:
    """Return the live page's HTML on HTTP 200, None otherwise."""
    try:
        response = session.get(PAGE_URL, headers=BROWSER_HEADERS, timeout=TIMEOUT)
    except requests.RequestException as error:
        print(f"Live fetch failed: {error}")
        return None
    if response.status_code != 200:
        print(f"Live fetch returned HTTP {response.status_code}")
        return None
    return response.text


def wayback_get(
    session: requests.Session, url: str, params: dict[str, str] | None = None
) -> requests.Response | None:
    """GET from web.archive.org, retrying through its transient 5xx 'Temporarily Offline' pages."""
    for attempt in range(1, WAYBACK_ATTEMPTS + 1):
        try:
            response = session.get(url, params=params, timeout=TIMEOUT)
        except requests.RequestException as error:
            print(f"Wayback request failed ({attempt}/{WAYBACK_ATTEMPTS}): {error}")
        else:
            if response.status_code == 200:
                return response
            print(f"Wayback returned HTTP {response.status_code} ({attempt}/{WAYBACK_ATTEMPTS}) for {response.url}")
        if attempt < WAYBACK_ATTEMPTS:
            time.sleep(5 * attempt)
    return None


def wayback_captures(session: requests.Session, since: str) -> list[str] | None:
    """Timestamps of the newest HTTP 200 captures since the given YYYYMMDD, oldest first.

    Returns None when the CDX API itself is unavailable.
    """
    response = wayback_get(
        session,
        CDX_URL,
        params={
            "url": PAGE_URL,
            "output": "json",
            "fl": "timestamp,statuscode",
            "filter": "statuscode:200",
            "from": since,
            # newest N captures; the page changes weekly and is captured a few
            # times a month, so this covers a blackout of a couple of months
            "limit": "-20",
        },
    )
    if response is None:
        return None
    try:
        rows = response.json()
    except ValueError:
        print(f"CDX API returned non-JSON: {response.text[:200]!r}")
        return None
    # the first row is a header (only present when there are results at all)
    return [timestamp for timestamp, _status in rows[1:]]


def fetch_wayback(session: requests.Session, data: Data) -> tuple[bool, str]:
    """Merge data from Wayback captures newer than what we already have.

    Returns (changed, reason), where reason explains why nothing changed.
    """
    since = latest_as_of(data).replace("-", "")
    timestamps = wayback_captures(session, since)
    if timestamps is None:
        return False, "the Wayback Machine is unavailable"
    if not timestamps:
        return False, f"the Wayback Machine has no HTTP 200 capture of the page since {since}"

    changed = False
    for timestamp in timestamps:
        response = wayback_get(session, WAYBACK_URL.format(timestamp=timestamp, url=PAGE_URL))
        if response is None:
            continue
        parsed = parse_page(response.text)
        if not parsed:
            print(f"Wayback capture {timestamp} matched no timeframe pattern")
            continue
        print(f"Wayback capture {timestamp} is as of {describe(parsed)}")
        changed |= merge(data, parsed, f"Wayback capture {timestamp}")
    return changed, f"Wayback captures since {since} hold nothing newer than {latest_as_of(data)}"


def save(data: Data) -> None:
    # keep each timeframe chronological, even if a fallback filled in an older gap
    for timeframe in data.values():
        for date in sorted(timeframe):
            timeframe[date] = timeframe.pop(date)
    with DATA_PATH.open("w") as data_file:
        json.dump(data, data_file, indent=2)
        data_file.write("\n")


def main() -> int:
    with DATA_PATH.open() as data_file:
        data: Data = json.load(data_file)
    print(f"Latest as_of date in {DATA_PATH}: {latest_as_of(data)}")

    session = requests.Session()

    live_html = fetch_live(session)
    live_parsed = parse_page(live_html) if live_html is not None else {}
    live_unparseable = live_html is not None and not live_parsed

    changed = False
    if live_parsed:
        # the live page is authoritative: nothing archived can be newer than it
        print(f"Live page is as of {describe(live_parsed)}")
        changed = merge(data, live_parsed, "live page")
        reason = f"the live page holds nothing newer than {latest_as_of(data)}"
    else:
        if live_unparseable:
            print("Live page was served (HTTP 200) but matched no timeframe pattern; trying the Wayback Machine")
        else:
            print("Falling back to the Wayback Machine")
        changed, reason = fetch_wayback(session, data)

    if changed:
        save(data)
        print(f"Wrote {DATA_PATH}")
        if live_unparseable:
            print("::warning::The live NVC page was served but matched no timeframe pattern; the site may have changed")
        return 0

    if live_unparseable:
        print(
            "ERROR: the live NVC page was served (HTTP 200) but none of the timeframe patterns matched, "
            "and the Wayback Machine had nothing newer either. The site has probably changed its wording "
            "or layout; update PATTERNS in data/nvc/main.py.",
            file=sys.stderr,
        )
        return 1

    print(f"::warning::No new NVC data: {reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
