"""Add a snapshot of State's IV Scheduling Status Tool to iv_schedule.json.

The tool lists, for each immigrant visa post, the month of documentarily
complete cases NVC is scheduling interviews for, in three columns: immediate
relatives, family preference and employment. State only ever shows its latest
monthly update, so every snapshot kept here is history nobody else keeps.

    uv run python iv_schedule.py --fetch
    uv run python iv_schedule.py --from-file page.html

--fetch downloads the page from these, in order:

1. travel.state.gov. It sits behind Cloudflare, which answers non-browser
   clients with a 403 challenge page (a challenge page served with HTTP 200
   counts as not served).
2. The same page on adoption.state.gov, which State serves without Cloudflare
   in front of it. The host is not advertised and could go away.
3. The newest Wayback Machine capture of either page since the newest
   snapshot's date.

It stops at the first page that parses, lists at least MIN_POST_SHARE of the
newest snapshot's posts, and is neither older than the newest snapshot nor
more than LIVE_MAX_AGE_DAYS old; a page that fails the last two checks may be
a stale copy (the mirror could stop being updated), so the next source is
tried too, and the newest page wins. A page listing too few posts, say a
truncated one, is refused: it would become the newest snapshot, the only one
the site reads, and take the interview card off every post it leaves out.

--fetch adds the page's update only when it is newer than the newest snapshot
in iv_schedule.json, and after adding one asks the Wayback Machine to capture
both pages (best effort, as in data/nvc/main.py). It asks only after a run
that added a snapshot, not after every successful fetch, on purpose: the
workflow runs this about 30 times on a Monday and daily otherwise, and a
capture of an update the archive already holds adds nothing. --from-file parses a page saved
from a browser instead, and adds its update when iv_schedule.json does not
have it yet, however old it is and however many posts it lists.

The page's single table is parsed, the snapshot is dated by the page's "Last
Updated: September 23, 2026" line, and State's post names are mapped to the
site's post slugs (from dump/post_slugs.ndjson). A snapshot date that is
already in iv_schedule.json is never overwritten. The script needs only
requests, beautifulsoup4 and lxml, so the scheduled workflow runs it without
the rest of this project's dependencies (see nvc_update_schedule.yml).

Exit codes: 0 when a snapshot was added, when there was nothing newer, or when
--fetch could not reach any source (a ``::warning::`` annotation is printed
then; the freshness workflow opens an issue once the newest snapshot gets too
old, see data/freshness.py); 1 when the page no longer parses (for --fetch:
some source served a page and none served one that parses and lists enough
posts), a post name matches no site post slug (add it to ALIASES), or a file
cannot be read, in which case nothing is written.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections.abc import Iterator
from datetime import UTC
from datetime import date
from datetime import datetime
from pathlib import Path
from typing import NamedTuple
from typing import TypedDict

import requests
from bs4 import BeautifulSoup

HERE = Path(__file__).parent
DATA_PATH = HERE / "iv_schedule.json"
POST_SLUGS_PATH = HERE / "dump" / "post_slugs.ndjson"
PAGE_PATH = "/content/travel/en/us-visas/visa-information-resources/iv-wait-times.html"
SOURCE_URL = f"https://travel.state.gov{PAGE_PATH}"
MIRROR_URL = f"https://adoption.state.gov{PAGE_PATH}"
# The live sources, in the order --fetch tries them
LIVE_URLS = (SOURCE_URL, MIRROR_URL)
CDX_URL = "https://web.archive.org/cdx/search/cdx"
WAYBACK_URL = "https://web.archive.org/web/{timestamp}id_/{url}"
SAVE_URL = "https://web.archive.org/save/{url}"
TIMEOUT = 60
# Save Page Now fetches the page itself before it answers
SAVE_TIMEOUT = 180
WAYBACK_ATTEMPTS = 3
# State updates the tool about monthly, so a page from --fetch older than this
# may be a stale copy, and the next source is tried too; the freshness check
# and the consulate pages call the data stale from then on as well
LIVE_MAX_AGE_DAYS = 45
# --fetch refuses a page that lists fewer posts than this share of the newest
# snapshot's (all snapshots so far list 142)
MIN_POST_SHARE = 0.9
# Signs of the bot challenge Cloudflare serves in place of the page, which it
# may do with HTTP 200
CHALLENGE_MARKERS = (
    "/cdn-cgi/challenge-platform/",
    "<title>Just a moment...</title>",
    "Attention Required! | Cloudflare",
)
USER_AGENT = "visawhen-bot (+https://github.com/underyx/visawhen)"
HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

HEADER = ["Post", "Employment Visa", "Preference Visa", "Relative Visa"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_NAMES = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
]
# "Feb-26"; some updates spell the year out, "Feb-2026"
MONTH_PATTERN = re.compile(r"(?P<month>[A-Z][a-z]{2})-(?P<year>\d{2}|\d{4})")
# "September 23, 2026", and variants such as "Sept. 23 2026" or "9/23/2026"
LAST_UPDATED_PATTERN = re.compile(
    r"Last Updated:\s*(?:(?P<month_name>[A-Za-z]+)\.?\s+(?P<day>\d{1,2}),?\s+(?P<year>\d{4})"
    r"|(?P<month_number>\d{1,2})/(?P<numeric_day>\d{1,2})/(?P<numeric_year>\d{4}))"
)
# Cells that mean State gives no month for the post
MISSING = {"N/A", "NA", "null", ""}
# State's names that don't reduce to a site post slug by dropping everything
# but the letters
ALIASES = {
    "Mumbai (Bombay)": "mumbai",
    "Kuwait": "kuwait-city",
    "Ulaanbataar": "ulaanbaatar",
}
# The table has a row for a post literally named "null"
SKIPPED_POSTS = {"null"}


class PostSchedule(TypedDict):
    """The months NVC is scheduling at a post, "2026-02", or None for N/A"""

    name: str
    relative: str | None
    preference: str | None
    employment: str | None


Snapshot = dict[str, PostSchedule]
# Per State post name, its (employment, preference, relative) months
Posts = dict[str, tuple[str | None, str | None, str | None]]


class Data(TypedDict):
    source: str
    snapshots: dict[str, Snapshot]


class Page(NamedTuple):
    """A page that parsed: where it came from, its update's date and its posts"""

    source: str
    as_of: str
    posts: Posts


class ParseError(Exception):
    pass


class InputError(Exception):
    """A file this script needs is missing or unreadable."""


def letters(text: str) -> str:
    return re.sub(r"[^a-z]", "", text.lower())


def parse_month(text: str) -> str | None:
    """'Feb-26' or 'Feb-2026' as '2026-02'; 'N/A' as None"""
    if text in MISSING:
        return None
    match = MONTH_PATTERN.fullmatch(text)
    if match is None or match["month"] not in MONTHS:
        raise ParseError(f"Unexpected month {text!r}")
    year = match["year"] if len(match["year"]) == 4 else f"20{match['year']}"
    return f"{year}-{MONTHS.index(match['month']) + 1:02d}"


def month_number(name: str) -> int:
    """'Sept', 'Sep' or 'September' as 9"""
    lowered = name.lower()
    matches = [
        number for number, month in enumerate(MONTH_NAMES, 1) if len(lowered) >= 3 and month.startswith(lowered)
    ]
    if len(matches) != 1:
        raise ParseError(f"Unexpected month {name!r} in the 'Last Updated' date")
    return matches[0]


def parse_last_updated(text: str) -> str:
    dates = set()
    for match in LAST_UPDATED_PATTERN.finditer(text):
        if match["month_name"] is not None:
            parts = (int(match["year"]), month_number(match["month_name"]), int(match["day"]))
        else:
            parts = (int(match["numeric_year"]), int(match["month_number"]), int(match["numeric_day"]))
        try:
            dates.add(date(*parts).isoformat())
        except ValueError:
            raise ParseError(f"The 'Last Updated' date is not a date: {match[0]!r}") from None
    if len(dates) != 1:
        raise ParseError(f"Expected one 'Last Updated' date on the page, found {sorted(dates) or 'none'}")
    return dates.pop()


def parse_page(html: str) -> tuple[str, Posts]:
    """The snapshot date and, per State post name, its (employment,
    preference, relative) months."""
    soup = BeautifulSoup(html, "lxml")
    tables = soup.find_all("table")
    if len(tables) != 1:
        raise ParseError(f"Expected one table on the page, found {len(tables)}")
    rows = tables[0].find_all("tr")
    if not rows:
        raise ParseError("The table has no rows")
    header = [cell.get_text(" ", strip=True) for cell in rows[0].find_all(["th", "td"])]
    if header != HEADER:
        raise ParseError(f"Unexpected table header {header}")

    posts: Posts = {}
    for row in rows[1:]:
        cells = [cell.get_text(" ", strip=True) for cell in row.find_all(["th", "td"])]
        if len(cells) != len(HEADER):
            raise ParseError(f"Unexpected row {cells}")
        name, employment, preference, relative = cells
        if name in SKIPPED_POSTS:
            continue
        if name in posts:
            raise ParseError(f"{name} is in the table twice")
        posts[name] = (parse_month(employment), parse_month(preference), parse_month(relative))
    if not posts:
        raise ParseError("The table has no posts")
    return parse_last_updated(soup.get_text(" ")), posts


def load_post_slugs() -> list[str]:
    """The site's post slugs, from the consulates database's dump."""
    try:
        with POST_SLUGS_PATH.open(encoding="utf-8") as dump_file:
            return [json.loads(line)[0] for line in dump_file if line.strip()]
    except (OSError, ValueError, IndexError) as error:
        raise InputError(f"cannot read the site's post slugs from {POST_SLUGS_PATH}: {error}") from None


def match_slugs(names: list[str], post_slugs: list[str]) -> tuple[dict[str, str], list[str]]:
    """Each State post name's site post slug, and the names that match none"""
    by_letters = {letters(slug): slug for slug in post_slugs}
    matched: dict[str, str] = {}
    unmatched: list[str] = []
    for name in names:
        slug = ALIASES.get(name) or by_letters.get(letters(name))
        if slug is None or slug not in post_slugs:
            unmatched.append(name)
        else:
            matched[name] = slug
    return matched, unmatched


def load_data(path: Path) -> Data:
    if not path.exists():
        return {"source": SOURCE_URL, "snapshots": {}}
    try:
        with path.open(encoding="utf-8") as data_file:
            data: Data = json.load(data_file)
    except (OSError, ValueError) as error:
        raise InputError(f"cannot read {path}: {error}") from None
    return data


def save_data(data: Data, path: Path) -> None:
    data["snapshots"] = {
        as_of: {slug: snapshot[slug] for slug in sorted(snapshot)}
        for as_of, snapshot in sorted(data["snapshots"].items())
    }
    with path.open("w", encoding="utf-8") as data_file:
        json.dump(data, data_file, indent=2, ensure_ascii=False)
        data_file.write("\n")


# --- fetching (--fetch) -------------------------------------------------------


def is_challenge(html: str) -> bool:
    """Whether a page is Cloudflare's bot challenge rather than State's"""
    return any(marker in html for marker in CHALLENGE_MARKERS)


def page_title(html: str) -> str:
    """The page's <title>, to say in an error what a source served"""
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    return " ".join(match[1].split()) if match else "(no title)"


def fetch_page(session: requests.Session, url: str) -> str | None:
    """The page's HTML on HTTP 200, None otherwise, or when it is a bot challenge."""
    try:
        response = session.get(url, timeout=TIMEOUT)
    except requests.RequestException as error:
        print(f"{url}: request failed: {error}")
        return None
    if response.status_code != 200:
        print(f"{url}: HTTP {response.status_code}")
        return None
    if is_challenge(response.text):
        print(f"{url}: HTTP 200, but a bot challenge page ({page_title(response.text)!r})")
        return None
    return response.text


def wayback_get(
    session: requests.Session, url: str, params: dict[str, str] | None = None
) -> requests.Response | None:
    """GET from web.archive.org, retrying through its transient 5xx pages and resets."""
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


def newest_capture(session: requests.Session, since: str | None) -> tuple[str, str] | None:
    """(timestamp, url) of the newest HTTP 200 capture of either page, since
    the given day, "2026-09-23", if one is given."""
    captures: list[tuple[str, str]] = []
    params = {"output": "json", "fl": "timestamp", "filter": "statuscode:200", "limit": "-1"}
    if since is not None:
        params["from"] = since.replace("-", "")
    for url in LIVE_URLS:
        response = wayback_get(session, CDX_URL, params={"url": url, **params})
        if response is None:
            continue
        try:
            rows = response.json()
        except ValueError:
            print(f"CDX API returned non-JSON: {response.text[:200]!r}")
            continue
        # the first row is a header (only present when there are results at all)
        captures += [(row[0], url) for row in rows[1:]]
    return max(captures, default=None)


def fetch_pages(since: str | None) -> Iterator[tuple[str, str]]:
    """The tool's page from each source that serves it, in order, as (where
    from, its HTML); the Wayback Machine, for its newest capture since the
    given day, is asked only when the caller asks for more than the live
    sources gave."""
    session = requests.Session()
    session.headers.update(HEADERS)
    for url in LIVE_URLS:
        html = fetch_page(session, url)
        if html is not None:
            yield url, html
    print("Trying the Wayback Machine")
    capture = newest_capture(session, since)
    if capture is None:
        print("The Wayback Machine has no capture of the page" + (f" since {since}" if since else ""))
        return
    timestamp, url = capture
    response = wayback_get(session, WAYBACK_URL.format(timestamp=timestamp, url=url))
    if response is not None:
        yield f"Wayback capture {timestamp} of {url}", response.text


def save_page_now(url: str) -> None:
    """Ask the Wayback Machine to capture url now. Best effort: a failure is a warning."""
    try:
        response = requests.get(SAVE_URL.format(url=url), headers=HEADERS, timeout=SAVE_TIMEOUT, allow_redirects=False)
    except requests.RequestException as error:
        print(f"::warning::Save Page Now failed for {url}: {error}")
        return
    location = response.headers.get("Location", "") or response.headers.get("Content-Location", "")
    match = re.search(r"/web/(\d{14})", location)
    if response.status_code not in (200, 302) or match is None:
        print(f"::warning::Save Page Now did not capture {url} (HTTP {response.status_code})")
        return
    print(f"Save Page Now captured {url} as {match[1]}")


# --- main ---------------------------------------------------------------------


class Fetched(NamedTuple):
    """What --fetch found: the newest page that is fit to add, or None, and
    what was wrong with the pages that are not"""

    page: Page | None
    # pages that were served but do not parse, with what each is
    unparseable: list[str]
    # pages that list too few posts
    incomplete: list[str]


def fetch_newest(data: Data, today: date) -> Fetched:
    """Go through fetch_pages() until a page parses, lists enough posts, and is
    neither older than the newest snapshot nor more than LIVE_MAX_AGE_DAYS
    old; of the pages that parse and list enough posts, the newest wins."""
    newest = max(data["snapshots"], default=None)
    newest_posts = len(data["snapshots"][newest]) if newest is not None else 0
    best: Page | None = None
    unparseable: list[str] = []
    incomplete: list[str] = []
    for source, html in fetch_pages(newest):
        try:
            as_of, posts = parse_page(html)
        except ParseError as error:
            print(f"{source} does not parse: {error}")
            unparseable.append(f"{source}, a page titled {page_title(html)!r}: {error}")
            continue
        print(f"{source}: {len(posts)} posts, last updated {as_of}")
        if len(posts) < MIN_POST_SHARE * newest_posts:
            problem = (
                f"{source} lists only {len(posts)} posts, against {newest_posts} in the newest snapshot ({newest})"
            )
            print(f"::warning::{problem}; a partial page? Not using it")
            incomplete.append(problem)
            continue
        if best is None or as_of > best.as_of:
            best = Page(source, as_of, posts)
        age = (today - date.fromisoformat(as_of)).days
        if newest is not None and as_of < newest:
            print(f"{source} is older than the newest snapshot, {newest}; it may be a stale copy")
        elif age > LIVE_MAX_AGE_DAYS:
            print(f"{source} is {age} days old; it may be a stale copy")
        else:
            break
    return Fetched(best, unparseable, incomplete)


def run(args: argparse.Namespace) -> int:
    data = load_data(args.data)
    if args.fetch:
        fetched = fetch_newest(data, datetime.now(UTC).date())
        if fetched.page is None:
            if fetched.unparseable or fetched.incomplete:
                print("ERROR: no source served a page that can be added.", file=sys.stderr)
                for problem in fetched.unparseable:
                    print(f"  Does not parse: {problem}", file=sys.stderr)
                for problem in fetched.incomplete:
                    print(f"  Too few posts: {problem}", file=sys.stderr)
                if fetched.unparseable:
                    print(
                        "A page that is State's tool but no longer parses means State changed it: update "
                        "parse_page in data/consulates/iv_schedule.py. A page that is something else, such as an "
                        "error page, needs no change here.",
                        file=sys.stderr,
                    )
                if fetched.incomplete:
                    print(
                        "Check the tool in a browser. If State really lists fewer posts now, save the page and "
                        "add it with --from-file.",
                        file=sys.stderr,
                    )
                return 1
            print("::warning::No new IV Scheduling Status Tool data: no source served the page")
            return 0
        source, as_of, posts = fetched.page
    else:
        source = str(args.from_file)
        try:
            html = args.from_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as error:
            raise InputError(f"cannot read {args.from_file}: {error}") from None
        try:
            as_of, posts = parse_page(html)
        except ParseError as error:
            print(
                f"ERROR: {source} does not parse: {error}. If it is State's tool, saved in full, State has "
                "changed the page: update parse_page in data/consulates/iv_schedule.py.",
                file=sys.stderr,
            )
            return 1
        print(f"{source}: {len(posts)} posts, last updated {as_of}")

    slugs, unmatched = match_slugs(list(posts), load_post_slugs())
    if unmatched:
        print(
            f"ERROR: no site post slug for {', '.join(unmatched)}; map each to one in ALIASES in iv_schedule.py",
            file=sys.stderr,
        )
        return 1
    if len(set(slugs.values())) != len(slugs):
        print("ERROR: two of State's posts map to the same site post slug", file=sys.stderr)
        return 1

    newest = max(data["snapshots"], default=None)
    if args.fetch and newest is not None and as_of < newest:
        print(f"::warning::No new IV Scheduling Status Tool data: {source} is older than the newest snapshot, {newest}")
        return 0
    if as_of in data["snapshots"]:
        print(f"{args.data} already has the snapshot of {as_of}; leaving it as it is")
        return 0
    data["snapshots"][as_of] = {
        slugs[name]: {"name": name, "relative": relative, "preference": preference, "employment": employment}
        for name, (employment, preference, relative) in posts.items()
    }
    save_data(data, args.data)
    print(f"Added the snapshot of {as_of} to {args.data}")
    # Only after a run that added a snapshot; see the docstring.
    if args.fetch and source in LIVE_URLS:
        for url in LIVE_URLS:
            save_page_now(url)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--fetch", action="store_true", help="download the tool's page")
    source.add_argument("--from-file", type=Path, help="the tool's page, saved from a browser")
    parser.add_argument("--data", type=Path, default=DATA_PATH, help=f"the JSON to merge into (default: {DATA_PATH.name})")
    args = parser.parse_args()
    try:
        return run(args)
    except InputError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
