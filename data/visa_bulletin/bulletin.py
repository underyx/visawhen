"""Add the State Department's monthly Visa Bulletins to data.json.

Each bulletin has two charts for the family-sponsored and the
employment-based preference categories: Final Action Dates (who can be
issued a visa or approved for a green card) and Dates for Filing (who can
send in their application). Every chart gives, per category and per
chargeability area, a cutoff date, or "C" (current: no cutoff) or "U"
(unavailable: no visas at all). data.json keeps every bulletin since
FIRST_MONTH, October 2015, the first with both charts.

    uv run python bulletin.py                                  # --fetch
    uv run python bulletin.py --from-file page.html --month 2026-10

--fetch reads the list of bulletins on State's Visa Bulletin page, adds the
ones since FIRST_MONTH that data.json does not have yet, and tries the next
two months' addresses too, in case the list is behind. It fetches each page
from these, in order:

1. travel.state.gov. It sits behind Cloudflare, which answers non-browser
   clients with a 403 challenge page (a challenge page served with HTTP 200
   counts as not served).
2. The same page on adoption.state.gov, which State serves without Cloudflare
   in front of it. The host is not advertised and could go away.
3. The Wayback Machine's capture of the page on either host nearest to the
   bulletin's month (for State's list of bulletins, nearest to today).

A month that is already in data.json is never fetched or overwritten again:
State publishes each bulletin once, about the middle of the month before, and
the month is the key. After a run that added one or two bulletins, which is
what a monthly run adds, it asks the Wayback Machine to capture their pages
(best effort, as in data/nvc/main.py), so that the last fallback has
something to fall back to.

--from-file parses a page saved from a browser instead, for the month given,
and adds it when data.json does not have that month yet.

The charts are the tables whose header row names the chargeability areas
("All Chargeability Areas Except Those Listed", "CHINA-mainland born" and so
on). A table's rows say whether it is a family (F1 to F4) or an employment
(1st to 5th) chart; of each kind, the first is Final Action Dates and the
second Dates for Filing, the order State has kept since October 2015. A row,
a column or a cell that none of the patterns below knows fails the page
rather than being skipped, so that a change in State's format is noticed.

Exit codes: 0 when bulletins were added, when there was nothing new, or when
no source could be reached (a ``::warning::`` annotation is printed then; the
freshness workflow opens an issue once the newest bulletin gets too old, see
data/freshness.py); 1 when a page was served but does not parse, in which case
the bulletins that did parse are still written, or when a file cannot be
read.
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
from typing import TypedDict

import requests
from bs4 import BeautifulSoup
from bs4 import Tag

HERE = Path(__file__).parent
DATA_PATH = HERE / "data.json"
BULLETINS_PATH = "/content/travel/en/legal/visa-law0/visa-bulletin"
INDEX_PATH = f"{BULLETINS_PATH}.html"
LIVE_HOSTS = ("https://travel.state.gov", "https://adoption.state.gov")
WAYBACK_URL = "https://web.archive.org/web/{timestamp}id_/{url}"
SAVE_URL = "https://web.archive.org/save/{url}"
TIMEOUT = 60
# Save Page Now fetches the page itself before it answers
SAVE_TIMEOUT = 180
WAYBACK_ATTEMPTS = 3
# Between two bulletin pages, so that filling in years of them does not
# hammer State's servers
FETCH_DELAY_SECONDS = 1
# The first bulletin with both charts, Final Action Dates and Dates for Filing
FIRST_MONTH = "2015-10"
# Asking the Wayback Machine to capture a whole backfill would take hours;
# a monthly run adds one bulletin, sometimes two
MAX_SAVES = 2
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
MONTH_ABBREVIATIONS = [name[:3].upper() for name in MONTH_NAMES]
# A bulletin's page, ".../visa-bulletin/2026/visa-bulletin-for-october-2025.html";
# a few old ones leave out the "for-". The folder is the fiscal year.
BULLETIN_LINK_PATTERN = re.compile(
    rf"{re.escape(BULLETINS_PATH)}/(?P<folder>\d{{4}})/visa-bulletin-(?:for-)?(?P<month>[a-z]+)-(?P<year>\d{{4}})\.html"
)
# "01JAN08"; the year has two digits
DATE_PATTERN = re.compile(r"(?P<day>\d{1,2})(?P<month>[A-Z]{3})(?P<year>\d{2})")

# The chargeability areas, by a word of their column's heading
AREAS = {
    "all": re.compile(r"all chargeability"),
    "china": re.compile(r"china"),
    "india": re.compile(r"india"),
    "mexico": re.compile(r"mexico"),
    "philippines": re.compile(r"philippines"),
    "el-salvador-guatemala-honduras": re.compile(r"el salvador"),
    "vietnam": re.compile(r"vietnam"),
}
# The categories, by the start of their row's label, lowercased
FAMILY_CATEGORIES = {
    "F1": re.compile(r"f1$"),
    "F2A": re.compile(r"f2a$"),
    "F2B": re.compile(r"f2b$"),
    "F3": re.compile(r"f3$"),
    "F4": re.compile(r"f4$"),
}
EMPLOYMENT_CATEGORIES = {
    "EB-1": re.compile(r"1st$"),
    "EB-2": re.compile(r"2nd$"),
    "EB-3": re.compile(r"3rd$"),
    # EB-3 for jobs that need less than two years of training or experience
    "EW": re.compile(r"other workers$"),
    "EB-4": re.compile(r"4th$"),
    # EB-4 for religious workers other than ministers
    "SR": re.compile(r"certain religious workers$"),
    # the EB-5 rows since the EB-5 Reform and Integrity Act of 2022; in May
    # 2022 alone, the regional center investors (I5 and R5) had a row of their
    # own, "5th Unreserved (I5 and R5)"
    "EB-5-unreserved-regional-center": re.compile(r"5th unreserved.*\bi5 and r5\b"),
    "EB-5-unreserved": re.compile(r"5th unreserved"),
    "EB-5-rural": re.compile(r"5th set aside.*rural"),
    "EB-5-high-unemployment": re.compile(r"5th set aside.*high unemployment"),
    "EB-5-infrastructure": re.compile(r"5th set aside.*infrastructure"),
    # and before it; until October 2015, the regional center row was
    # "5th Targeted Employment Areas/ Regional Centers and Pilot Programs"
    "EB-5-non-regional-center": re.compile(r"5th non-regional center"),
    "EB-5-regional-center": re.compile(r"5th (regional center|targeted employment areas)"),
}

# One chart: category -> area -> "2020-01-22", "C" or "U"
Chart = dict[str, dict[str, str]]


class Bulletin(TypedDict):
    url: str
    finalAction: Chart
    datesForFiling: Chart


class Data(TypedDict):
    source: str
    bulletins: dict[str, Bulletin]


class ParseError(Exception):
    """A page that does not look like a Visa Bulletin we know how to read"""


# --- parsing ------------------------------------------------------------------


def cell_text(cell: Tag) -> str:
    return " ".join(cell.get_text(" ").replace("\xa0", " ").split())


def parse_value(text: str, bulletin_year: int) -> str:
    """A cell: "C", "U", or a date as "2008-01-01"."""
    value = text.upper().replace(" ", "").rstrip("*")
    if value in ("C", "U"):
        return value
    match = DATE_PATTERN.fullmatch(value)
    if match is None or match["month"] not in MONTH_ABBREVIATIONS:
        raise ParseError(f"cannot read the cell {text!r}")
    year = 2000 + int(match["year"])
    # two-digit years: the cutoff dates of 2015 go back to the early 1990s
    if year > bulletin_year + 1:
        year -= 100
    try:
        return date(year, MONTH_ABBREVIATIONS.index(match["month"]) + 1, int(match["day"])).isoformat()
    except ValueError as error:
        raise ParseError(f"cannot read the cell {text!r}: {error}") from error


def match_label(label: str, patterns: dict[str, re.Pattern[str]]) -> str | None:
    normalized = " ".join(re.sub(r"[^a-z0-9%,.:()\- ]", " ", label.lower()).split()).strip(" *.")
    for key, pattern in patterns.items():
        if pattern.match(normalized):
            return key
    return None


def row_category(label: str) -> tuple[str, str] | None:
    """A row's ("family" or "employment", its category), or None"""
    if (family := match_label(label, FAMILY_CATEGORIES)) is not None:
        return "family", family
    if (employment := match_label(label, EMPLOYMENT_CATEGORIES)) is not None:
        return "employment", employment
    return None


def parse_table(table: Tag, bulletin_year: int) -> tuple[str, Chart] | None:
    """A chart as ("family" or "employment", the chart), or None when the
    table is not one: when no header row names chargeability areas, or no
    row is a preference category (the diversity visa table names
    chargeability areas too)."""
    rows = [[cell_text(cell) for cell in row.find_all(["td", "th"])] for row in table.find_all("tr")]
    rows = [row for row in rows if any(row)]
    header_index = next(
        (index for index, row in enumerate(rows) if any("chargeability" in cell.lower() for cell in row)), None
    )
    if header_index is None:
        return None
    header, body = rows[header_index], rows[header_index + 1 :]
    categories = [row_category(row[0]) for row in body]
    kinds = {category[0] for category in categories if category is not None}
    if not kinds:
        return None
    if len(kinds) > 1:
        raise ParseError(f"a table headed {header!r} mixes family and employment categories")

    areas: list[str] = []
    for heading in header[1:]:
        area = next((key for key, pattern in AREAS.items() if pattern.search(heading.lower())), None)
        if area is None:
            raise ParseError(f"unknown chargeability area {heading!r} in a table headed {header!r}")
        areas.append(area)

    chart: Chart = {}
    for row, category in zip(body, categories, strict=True):
        if category is None:
            raise ParseError(f"unknown category {row[0]!r} in a table headed {header!r}")
        cells = row[1:]
        if len(cells) != len(areas):
            raise ParseError(f"the row {row!r} has {len(cells)} cells for {len(areas)} areas")
        if category[1] in chart:
            raise ParseError(f"the category {row[0]!r} appears twice in a table")
        chart[category[1]] = {area: parse_value(cell, bulletin_year) for area, cell in zip(areas, cells, strict=True)}
    return kinds.pop(), chart


def parse_page(html: str, month: str) -> tuple[Chart, Chart]:
    """The bulletin's (Final Action Dates, Dates for Filing), both charts
    with the family and the employment categories."""
    soup = BeautifulSoup(html, "lxml")
    charts: dict[str, list[Chart]] = {"family": [], "employment": []}
    for table in soup.find_all("table"):
        # a table laid out around others is not a chart; the ones inside are
        if table.find("table") is not None:
            continue
        parsed = parse_table(table, int(month[:4]))
        if parsed is not None:
            kind, chart = parsed
            charts[kind].append(chart)
    for kind, found in charts.items():
        if len(found) != 2:
            raise ParseError(f"found {len(found)} {kind} charts, not 2 (Final Action Dates and Dates for Filing)")
    final_action = charts["family"][0] | charts["employment"][0]
    dates_for_filing = charts["family"][1] | charts["employment"][1]
    return final_action, dates_for_filing


# --- data.json ----------------------------------------------------------------


def load_data(path: Path) -> Data:
    with path.open(encoding="utf-8") as data_file:
        data: Data = json.load(data_file)
    return data


def save_data(data: Data, path: Path) -> None:
    """One line per category, so that a new bulletin is a readable diff."""
    bulletins = data["bulletins"]
    lines = ["{", f'  "source": {json.dumps(data["source"])},', '  "bulletins": {']
    for index, month in enumerate(sorted(bulletins)):
        bulletin = bulletins[month]
        lines.append(f"    {json.dumps(month)}: {{")
        lines.append(f'      "url": {json.dumps(bulletin["url"])},')
        charts = (("finalAction", bulletin["finalAction"]), ("datesForFiling", bulletin["datesForFiling"]))
        for chart_index, (chart_name, chart) in enumerate(charts):
            lines.append(f"      {json.dumps(chart_name)}: {{")
            categories = list(chart)
            for category_index, category in enumerate(categories):
                comma = "," if category_index < len(categories) - 1 else ""
                lines.append(f"        {json.dumps(category)}: {json.dumps(chart[category])}{comma}")
            lines.append("      }" + ("," if chart_index == 0 else ""))
        lines.append("    }" + ("," if index < len(bulletins) - 1 else ""))
    lines += ["  }", "}", ""]
    path.write_text("\n".join(lines), encoding="utf-8")


def add_bulletin(data: Data, month: str, url: str, html: str) -> None:
    final_action, dates_for_filing = parse_page(html, month)
    data["bulletins"][month] = {"url": url, "finalAction": final_action, "datesForFiling": dates_for_filing}
    print(f"+ {month}: {len(final_action)} categories ({url})")


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


def wayback_get(session: requests.Session, url: str) -> requests.Response | None:
    """GET from web.archive.org, retrying through its transient 5xx pages and
    resets; None when it fails, or at once when the archive has no capture."""
    for attempt in range(1, WAYBACK_ATTEMPTS + 1):
        try:
            response = session.get(url, timeout=TIMEOUT)
        except requests.RequestException as error:
            print(f"Wayback request failed ({attempt}/{WAYBACK_ATTEMPTS}): {error}")
        else:
            if response.status_code == 200:
                return response
            print(f"Wayback returned HTTP {response.status_code} ({attempt}/{WAYBACK_ATTEMPTS}) for {response.url}")
            if response.status_code < 500:
                return None
        if attempt < WAYBACK_ATTEMPTS:
            time.sleep(5 * attempt)
    return None


def fetch_pages(session: requests.Session, path: str, near: str) -> Iterator[tuple[str, str]]:
    """The page at path from each source that serves it, in order, as (where
    from, its HTML); the Wayback Machine, for its capture of the page on
    either host nearest to the day near ("20161215"), is asked only when the
    caller asks for more than the live hosts gave. The archive finds the
    nearest capture itself, so that this does not depend on its search API,
    which is often down."""
    for host in LIVE_HOSTS:
        html = fetch_page(session, f"{host}{path}")
        if html is not None:
            yield f"{host}{path}", html
    for host in LIVE_HOSTS:
        response = wayback_get(session, WAYBACK_URL.format(timestamp=near, url=f"{host}{path}"))
        if response is not None and not is_challenge(response.text):
            yield f"Wayback capture {response.url}", response.text


def bulletin_path(month: str) -> str:
    """The page of a month's bulletin, as State names them: the folder is the
    fiscal year, which starts in October."""
    year, month_number = int(month[:4]), int(month[5:])
    fiscal_year = year + 1 if month_number >= 10 else year
    return f"{BULLETINS_PATH}/{fiscal_year}/visa-bulletin-for-{MONTH_NAMES[month_number - 1]}-{year}.html"


def listed_bulletins(session: requests.Session, today: date) -> dict[str, str] | None:
    """The bulletins State's Visa Bulletin page links to, as month -> path, or
    None when no source serves the page."""
    for source, html in fetch_pages(session, INDEX_PATH, today.strftime("%Y%m%d")):
        listed: dict[str, str] = {}
        for match in BULLETIN_LINK_PATTERN.finditer(html):
            if match["month"] not in MONTH_NAMES:
                continue
            month = f"{match['year']}-{MONTH_NAMES.index(match['month']) + 1:02d}"
            listed.setdefault(month, match[0])
        if listed:
            print(f"{source} lists {len(listed)} bulletins, the newest for {max(listed)}")
            return listed
        print(f"{source} lists no bulletins ({page_title(html)!r})")
    return None


def addmonths(month: str, months: int) -> str:
    """The month some months after another: ("2026-10", -1) is "2026-09" """
    index = int(month[:4]) * 12 + int(month[5:]) - 1 + months
    return f"{index // 12}-{index % 12 + 1:02d}"


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


def fetch(data: Data, today: date) -> int:
    session = requests.Session()
    session.headers.update(HEADERS)
    listed = listed_bulletins(session, today) or {}
    # The list may be behind, or unreachable: try this month's and next
    # month's addresses as well. State publishes a bulletin around the middle
    # of the month before.
    this_month = f"{today.year}-{today.month:02d}"
    for month in (this_month, addmonths(this_month, 1)):
        listed.setdefault(month, bulletin_path(month))
    wanted = sorted(month for month in listed if month >= FIRST_MONTH and month not in data["bulletins"])
    print(f"Newest bulletin in {DATA_PATH.name}: {max(data['bulletins'], default='none')}; fetching {wanted}")

    added: list[str] = []
    unparseable: list[str] = []
    for month in wanted:
        errors: list[str] = []
        # the middle of the month before, around when State publishes it
        near = f"{addmonths(month, -1).replace('-', '')}15"
        for source, html in fetch_pages(session, listed[month], near):
            try:
                add_bulletin(data, month, f"{LIVE_HOSTS[0]}{listed[month]}", html)
            except ParseError as error:
                print(f"{source} does not parse: {error}")
                errors.append(f"{source}, a page titled {page_title(html)!r}: {error}")
                continue
            added.append(month)
            break
        else:
            if errors:
                unparseable.append(f"{month}: " + "; ".join(errors))
            else:
                print(f"No source serves the bulletin for {month}")
        time.sleep(FETCH_DELAY_SECONDS)

    if added:
        save_data(data, DATA_PATH)
        print(f"Wrote {DATA_PATH}: added {', '.join(added)}")
        if len(added) <= MAX_SAVES:
            for month in added:
                save_page_now(session, data["bulletins"][month]["url"])
    if unparseable:
        for problem in unparseable:
            print(f"::error::A Visa Bulletin page was served but does not parse: {problem}", file=sys.stderr)
        return 1
    if not added:
        # this month's and next month's bulletins count as missing only once
        # the freshness check says so
        print(f"::notice::No new bulletin; the newest is {max(data['bulletins'], default='none')}")
    return 0


# --- main ---------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fetch", action="store_true", help="fetch new bulletins (the default)")
    parser.add_argument("--from-file", type=Path, help="parse a bulletin page saved from a browser")
    parser.add_argument("--month", help="with --from-file: the bulletin's month, 2026-10")
    args = parser.parse_args()

    data = load_data(DATA_PATH)
    if args.from_file is None:
        return fetch(data, datetime.now(UTC).date())

    if args.month is None or not re.fullmatch(r"\d{4}-\d{2}", args.month):
        parser.error("--from-file needs --month, as 2026-10")
    if args.month in data["bulletins"]:
        print(f"{DATA_PATH.name} already has the bulletin for {args.month}")
        return 0
    try:
        html = args.from_file.read_text(encoding="utf-8")
        add_bulletin(data, args.month, f"{LIVE_HOSTS[0]}{bulletin_path(args.month)}", html)
    except (OSError, ParseError) as error:
        print(f"ERROR: {args.from_file}: {error}", file=sys.stderr)
        return 1
    save_data(data, DATA_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())
