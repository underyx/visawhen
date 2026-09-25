"""Scrape NVC processing time frames into data.json.

Sources, in order:

1. The page on travel.state.gov. It sits behind Cloudflare, which answers
   non-browser clients with a 403 challenge page.
2. The same page on adoption.state.gov. State serves the same content from
   that host without Cloudflare in front of it. The host is not advertised
   and could go away, so it is only a fallback.
3. The Wayback Machine, for captures of either page newer than our newest
   reading, when no live page parses or the one that does is more than a
   week old.

Every source is dated by its own content ("As of 21-Sep-26"), and a date that
is already in data.json is never overwritten, so a stale source can never
insert wrong data: the as_of date is the key.

Requests carry an honest user agent (USER_AGENT). After a run that added new
data, the Wayback Machine is asked to capture both pages (Save Page Now, as in
data/uscis/forms.py), so that the fallback has captures to fall back to; that
is best effort and never fails the run. It happens only after a run that added
data rather than after every successful fetch, on purpose: the workflow runs
this about 30 times on a Monday and daily otherwise, and a capture of a page
the archive already holds adds nothing.

Exit codes: 0 when new data was added or when every source is simply
unavailable or stale (a ``::warning::`` annotation is printed in the latter
case, and the freshness workflow opens an issue once the data gets too old,
see data/freshness.py); 1 when a page was served but no longer matches our
regexes and no source had anything new, or on any other error.
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

PAGE_PATH = "/content/travel/en/us-visas/immigrate/nvc-timeframes.html"
PAGE_URL = f"https://travel.state.gov{PAGE_PATH}"
MIRROR_URL = f"https://adoption.state.gov{PAGE_PATH}"
# The live sources, in the order they are tried
LIVE_URLS = (PAGE_URL, MIRROR_URL)
CDX_URL = "https://web.archive.org/cdx/search/cdx"
WAYBACK_URL = "https://web.archive.org/web/{timestamp}id_/{url}"
SAVE_URL = "https://web.archive.org/save/{url}"
DATA_PATH = Path(os.environ.get("NVC_DATA_PATH", "data.json"))
TIMEOUT = 60
# Save Page Now fetches the page itself before it answers
SAVE_TIMEOUT = 180
WAYBACK_ATTEMPTS = 3
# A live page older than this many days may be a stale copy; see main()
LIVE_MAX_AGE_DAYS = 7

USER_AGENT = "visawhen-bot (+https://github.com/underyx/visawhen)"
HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

PATTERNS: dict[TimeframeName, re.Pattern[str]] = {
    "creation": re.compile(
        r"Current case creation time frame: As of (?P<as_of_date>\d+-\w+-\d+), we are working on cases that were received from USCIS on (?P<latest_date>\d+-\w+-\d+)\."
    ),
    "review": re.compile(
        r"Current case review time: As of (?P<as_of_date>\d+-\w+-\d+), we are reviewing documents submitted to us on (?P<latest_date>\d+-\w+-\d+)\."
    ),
    "inquiry": re.compile(
        r"As of (?P<as_of_date>\d+-\w+-\d+), we are responding to inquiries received on (?P<latest_date>\d+-\w+-\d+)\."
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


def days_since(date: str) -> int:
    return (arrow.utcnow().date() - arrow.get(date).date()).days


def describe(parsed: Parsed) -> str:
    return ", ".join(sorted({as_of_date for as_of_date, _days in parsed.values()}))


def fetch_page(session: requests.Session, url: str) -> str | None:
    """The page's HTML on HTTP 200, None otherwise."""
    try:
        response = session.get(url, timeout=TIMEOUT)
    except requests.RequestException as error:
        print(f"{url}: request failed: {error}")
        return None
    if response.status_code != 200:
        print(f"{url}: HTTP {response.status_code}")
        return None
    return response.text


def fetch_live(session: requests.Session) -> tuple[str | None, Parsed, list[str]]:
    """The first live source whose page parses and what it says, or (None,
    {}), and the sources that served a page (HTTP 200) that did not parse."""
    unparseable: list[str] = []
    for url in LIVE_URLS:
        html = fetch_page(session, url)
        if html is None:
            continue
        parsed = parse_page(html)
        if parsed:
            return url, parsed, unparseable
        print(f"{url} was served (HTTP 200) but matched no timeframe pattern")
        unparseable.append(url)
    return None, {}, unparseable


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


def wayback_captures(session: requests.Session, since: str) -> list[tuple[str, str]] | None:
    """(timestamp, url) of the newest HTTP 200 captures of either page since
    the given YYYYMMDD, oldest first.

    Returns None when the CDX API is unavailable for both pages.
    """
    captures: list[tuple[str, str]] = []
    answered = False
    for url in LIVE_URLS:
        response = wayback_get(
            session,
            CDX_URL,
            params={
                "url": url,
                "output": "json",
                "fl": "timestamp,statuscode",
                "filter": "statuscode:200",
                "from": since,
                # newest N captures; the page changes weekly and is captured a
                # few times a month, so this covers a blackout of a couple of
                # months
                "limit": "-20",
            },
        )
        if response is None:
            continue
        try:
            rows = response.json()
        except ValueError:
            print(f"CDX API returned non-JSON: {response.text[:200]!r}")
            continue
        answered = True
        # the first row is a header (only present when there are results at all)
        captures += [(timestamp, url) for timestamp, _status in rows[1:]]
    return sorted(captures) if answered else None


def fetch_wayback(session: requests.Session, data: Data) -> tuple[bool, str]:
    """Merge data from Wayback captures newer than what we already have.

    Returns (changed, reason), where reason explains why nothing changed.
    """
    since = latest_as_of(data).replace("-", "")
    captures = wayback_captures(session, since)
    if captures is None:
        return False, "the Wayback Machine is unavailable"
    if not captures:
        return False, f"the Wayback Machine has no HTTP 200 capture of the page since {since}"

    changed = False
    for timestamp, url in captures:
        response = wayback_get(session, WAYBACK_URL.format(timestamp=timestamp, url=url))
        if response is None:
            continue
        parsed = parse_page(response.text)
        if not parsed:
            print(f"Wayback capture {timestamp} of {url} matched no timeframe pattern")
            continue
        print(f"Wayback capture {timestamp} of {url} is as of {describe(parsed)}")
        changed |= merge(data, parsed, f"Wayback capture {timestamp} of {url}")
    return changed, f"Wayback captures since {since} hold nothing newer than {latest_as_of(data)}"


def save_page_now(session: requests.Session, url: str) -> None:
    """Ask the Wayback Machine to capture url now. Best effort: a failure is a warning."""
    try:
        response = session.get(SAVE_URL.format(url=url), timeout=SAVE_TIMEOUT, allow_redirects=False)
    except requests.RequestException as error:
        print(f"::warning::Save Page Now failed for {url}: {error}")
        return
    location = response.headers.get("Location", "") or response.headers.get("Content-Location", "")
    match = re.search(r"/web/(\d{14})", location)
    if response.status_code not in (200, 302) or match is None:
        print(f"::warning::Save Page Now did not capture {url} (HTTP {response.status_code})")
        return
    print(f"Save Page Now captured {url} as {match[1]}")


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
    session.headers.update(HEADERS)

    live_url, live_parsed, unparseable = fetch_live(session)

    changed = False
    reason = ""
    if live_url is not None:
        print(f"{live_url} is as of {describe(live_parsed)}")
        if missing := sorted(set(PATTERNS) - set(live_parsed)):
            print(
                f"::warning::The NVC page matched no pattern for {', '.join(missing)}; "
                "the site may have changed its wording for those. Update PATTERNS in data/nvc/main.py."
            )
        changed = merge(data, live_parsed, live_url)
        reason = f"{live_url} holds nothing newer than {latest_as_of(data)}"
    # NVC updates the page weekly, so a live page older than a week may be a
    # stale copy (the mirror could stop being updated); the archive may hold
    # a newer capture then.
    live_age = None if live_url is None else days_since(max(as_of for as_of, _days in live_parsed.values()))
    if live_age is None or live_age > LIVE_MAX_AGE_DAYS:
        print(
            "No live source parsed"
            if live_age is None
            else f"{live_url} is {live_age} days old",
            "; trying the Wayback Machine",
            sep="",
        )
        wayback_changed, wayback_reason = fetch_wayback(session, data)
        changed |= wayback_changed
        reason = f"{reason}; {wayback_reason}" if reason else wayback_reason

    if changed:
        save(data)
        print(f"Wrote {DATA_PATH}")
        if live_url is not None:
            for url in LIVE_URLS:
                save_page_now(session, url)
        elif unparseable:
            print(
                f"::warning::{', '.join(unparseable)} was served but matched no timeframe pattern; the site may have changed"
            )
        return 0

    if live_url is None and unparseable:
        print(
            f"ERROR: {', '.join(unparseable)} was served (HTTP 200) but none of the timeframe patterns matched, "
            "and the Wayback Machine had nothing newer either. The site has probably changed its wording "
            "or layout; update PATTERNS in data/nvc/main.py.",
            file=sys.stderr,
        )
        return 1

    print(f"::warning::No new NVC data: {reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
