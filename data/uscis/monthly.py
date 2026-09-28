"""Add USCIS's monthly "Application Processing Data" reports to monthly.json.

Every month since November 2022, USCIS publishes for Congress (as the
Consolidated Appropriations Act, 2022 asked it to) a short CSV with, for six
forms, the applications received, approved and denied in the month, those
pending at its end and pending for more than six months, and the average
processing time of the cases decided in the month: the I-130, the I-360, the
I-485 by category (family, employment, asylum, refugee, Cuban and other), the
I-751, the I-765 and the N-400. The quarterly reports forms.py reads cover
every form, but come out about two months after their quarter ends; this one
comes out about four weeks after its month.

    uv run python monthly.py                                   # --fetch
    uv run python monthly.py --from-file report.csv --url URL  # a saved report

--fetch reads the list of reports on USCIS's Immigration and Citizenship Data
page and adds the months monthly.json does not have yet. The list and each
report come from, in order:

1. www.uscis.gov. It sits behind Akamai, which often answers HTTP 403 to
   scripts (see forms.py), although it served these reports to GitHub's
   runners in September 2026.
2. The Wayback Machine: for a report, its capture nearest to the month after
   the report's, when USCIS publishes it; for the list, and for a report it
   has not captured, Save Page Now.

The month is the one the report itself names ("For the Month of August
2026"), which must be the one the list names it by, and a month already in
monthly.json is never fetched or overwritten again: USCIS publishes each
month's report once. A column, a row or a cell the script does not know fails
the report rather than being skipped, so that a change in USCIS's layout is
noticed: add it to the tables at the top of the script.

--from-file parses a report saved from a browser instead, published at URL,
and adds its month when monthly.json does not have it yet.

Exit codes: 0 when months were added, when there was nothing new, or when no
source could be reached (a ``::warning::`` annotation is printed then; the
freshness workflow opens an issue once the newest month gets too old, see
data/freshness.py); 1 when a report was served but does not parse, in which
case the months that did parse are still written, or when a file cannot be
read.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import time
from pathlib import Path
from typing import NotRequired
from typing import TypedDict
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

HERE = Path(__file__).parent
DATA_PATH = HERE / "monthly.json"
USCIS = "https://www.uscis.gov"
# Searching for "Appropriations" lists every report, the newest first, on one page
LISTING_URL = f"{USCIS}/tools/reports-and-studies/immigration-and-citizenship-data?query=Appropriations&items_per_page=100"
WAYBACK_URL = "https://web.archive.org/web/{timestamp}id_/{url}"
SAVE_URL = "https://web.archive.org/save/{url}"
TIMEOUT = 60
# Save Page Now fetches the page itself before it answers
SAVE_TIMEOUT = 180
WAYBACK_ATTEMPTS = 3
# Between two reports, so that filling in years of them does not hammer USCIS
FETCH_DELAY_SECONDS = 1
# Asking the Wayback Machine to capture a whole backfill would take long; a
# monthly run adds one report, sometimes two
MAX_SAVES = 2
# The same browser user agent as forms.py: Akamai lets it through more often
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

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
MONTH = r"(?P<month>[A-Za-z]+),?\s+(?P<year>\d{4})"
# The list's link to a report: "FY22 Appropriations Reporting Requirement -
# Application Processing Data for August, 2026 (CSV, 3.54 KB)"
LINK_TEXT = re.compile(rf"Application Processing Data for {MONTH}", re.IGNORECASE)
# The report's own line naming its month
REPORT_MONTH = re.compile(rf"^For the Month of {MONTH}$", re.IGNORECASE)

# The columns, by their header (compared ignoring case and spacing), as the
# fields of monthly.json
COLUMNS = {
    "form number": "form",
    "description": "title",
    "forms received": "received",
    "approvals": "approved",
    "denials": "denied",
    "pending": "pending",
    "pending over 6 months": "pendingOver6Months",
    "pending over six months": "pendingOver6Months",
    "avg. processing time": "averageMonths",
}
COUNT_FIELDS = ("received", "approved", "denied", "pending", "pendingOver6Months")
# The forms the report covers. A form's only row is category "all"; the
# I-485's rows are its categories, by the parenthetical of their title, with
# the keys forms.py gives the same categories of the all-forms report.
FORMS = ("I-130", "I-360", "I-485", "I-751", "I-765", "N-400")
CATEGORIES = {
    "I-485": {
        "family": "family",
        "employment": "employment",
        "asylum": "asylum",
        "refugee": "refugee",
        "cuban": "cuban",
        "indo-chinese": "indo-chinese",
        "other": "other",
    },
}
# The notes under the table that every report has, numbered 1 to this: what
# the columns mean, and where the data comes from. A note after them is about
# that month in particular (March to June 2025: USCIS turned approved parole
# work permits back into pending ones, then approved them again), and is kept.
STANDARD_NOTES = 11
NOTE = re.compile(r"^(?P<number>\d+)\)\s*(?P<text>.+)$", re.DOTALL)


class Row(TypedDict):
    title: str
    received: int
    approved: int
    denied: int
    pending: int
    pendingOver6Months: int
    # USCIS's average processing time, in months, of the cases decided in the month
    averageMonths: float


class Report(TypedDict):
    url: str
    # per form, per category ("all" for a form's only row)
    forms: dict[str, dict[str, Row]]
    # USCIS's notes about this month in particular (STANDARD_NOTES)
    notes: NotRequired[list[str]]


class Data(TypedDict):
    source: str
    months: dict[str, Report]


class ParseError(Exception):
    """A file that does not look like a monthly report we know how to read"""


# --- parsing ------------------------------------------------------------------


def month_key(month_name: str, year: str) -> str:
    """("August", "2026") as "2026-08" """
    name = month_name.lower()
    if name not in MONTH_NAMES:
        raise ParseError(f"unknown month {month_name!r}")
    return f"{year}-{MONTH_NAMES.index(name) + 1:02d}"


def normalize(text: str) -> str:
    return " ".join(text.lower().split())


def decode(content: bytes) -> str:
    """The report's text: UTF-8 (with or without a byte order mark), or
    Windows-1252, which Excel writes."""
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return content.decode("cp1252")


def parse_count(text: str) -> int:
    if not re.fullmatch(r"\d{1,3}(?:,\d{3})*|\d+", text):
        raise ParseError(f"cannot read the count {text!r}")
    return int(text.replace(",", ""))


def parse_months(text: str) -> float:
    if not re.fullmatch(r"\d+(?:\.\d+)?", text):
        raise ParseError(f"cannot read the processing time {text!r}")
    return float(text)


def category_key(form: str, title: str) -> str:
    """The row's category: "all" for a form's only row, or for the I-485 the
    key of its title's parenthetical"""
    categories = CATEGORIES.get(form)
    if categories is None:
        return "all"
    parenthetical = re.search(r"\(([^()]+)\)\s*$", title)
    key = (
        None if parenthetical is None else categories.get(normalize(parenthetical[1]))
    )
    if key is None:
        raise ParseError(f"unknown {form} category in {title!r}")
    return key


def parse_report(content: bytes) -> tuple[str, dict[str, dict[str, Row]], list[str]]:
    """The report's month ("2026-08"), its rows per form and category, and
    its notes about the month in particular (STANDARD_NOTES)."""
    rows = [[cell.strip() for cell in row] for row in csv.reader(io.StringIO(decode(content)))]
    month = None
    header_index = None
    for index, row in enumerate(rows):
        first = row[0] if row else ""
        if (match := REPORT_MONTH.match(first)) is not None:
            month = month_key(match["month"], match["year"])
        if normalize(first) == "form number":
            header_index = index
            break
    if month is None:
        raise ParseError("no line names the report's month")
    if header_index is None:
        raise ParseError("no header row starting with 'Form Number'")

    fields: list[str | None] = []
    for heading in rows[header_index]:
        if heading == "":
            fields.append(None)
            continue
        field = COLUMNS.get(normalize(heading))
        if field is None:
            raise ParseError(f"unknown column {heading!r}")
        fields.append(field)
    missing = set(COLUMNS.values()) - set(fields)
    if missing:
        raise ParseError(f"no column for {', '.join(sorted(missing))}")

    forms: dict[str, dict[str, Row]] = {}
    end = len(rows)
    for index, row in enumerate(rows[header_index + 1 :], start=header_index + 1):
        # the notes under the table
        if not row or row[0] == "" or normalize(row[0]).startswith("notes"):
            end = index
            break
        cells = {field: cell for field, cell in zip(fields, row, strict=False) if field}
        if any(cell != "" for cell in row[len(fields) :]):
            raise ParseError(f"the row {row!r} has more cells than the header")
        form = cells.get("form", "")
        if form not in FORMS:
            raise ParseError(f"unknown form {form!r} in the row {row!r}")
        title = cells.get("title", "")
        key = category_key(form, title)
        if key in forms.get(form, {}):
            raise ParseError(f"{form} {key} appears twice")
        counts = {field: parse_count(cells.get(field, "")) for field in COUNT_FIELDS}
        forms.setdefault(form, {})[key] = {
            "title": title,
            "received": counts["received"],
            "approved": counts["approved"],
            "denied": counts["denied"],
            "pending": counts["pending"],
            "pendingOver6Months": counts["pendingOver6Months"],
            "averageMonths": parse_months(cells.get("averageMonths", "")),
        }
    if missing_forms := [form for form in FORMS if form not in forms]:
        raise ParseError(f"no row for {', '.join(missing_forms)}")
    notes = [
        " ".join(match["text"].split())
        for row in rows[end:]
        if row and (match := NOTE.match(row[0])) is not None and int(match["number"]) > STANDARD_NOTES
    ]
    return month, forms, notes


# --- monthly.json -------------------------------------------------------------


def load_data(path: Path) -> Data:
    if not path.exists():
        return {"source": LISTING_URL, "months": {}}
    with path.open(encoding="utf-8") as data_file:
        data: Data = json.load(data_file)
    return data


def save_data(data: Data, path: Path) -> None:
    """Months in order, formatted as Prettier (pre-commit) would."""
    data["months"] = dict(sorted(data["months"].items()))
    with path.open("w", encoding="utf-8") as data_file:
        json.dump(data, data_file, indent=2, ensure_ascii=False)
        data_file.write("\n")


def add_report(data: Data, url: str, content: bytes, expected_month: str | None = None) -> str:
    """Parse a report and add its month; the month."""
    month, forms, notes = parse_report(content)
    if expected_month is not None and month != expected_month:
        raise ParseError(f"the report listed for {expected_month} is for {month}")
    data["months"][month] = {"url": url, "forms": forms}
    if notes:
        data["months"][month]["notes"] = notes
    print(f"+ {month}: {sum(len(categories) for categories in forms.values())} rows ({url})")
    return month


# --- fetching (--fetch) -------------------------------------------------------


def looks_like_report(content: bytes) -> bool:
    """Whether a response is a report rather than an error or block page"""
    text = content[:4000].decode("utf-8", errors="replace").lower()
    return "<html" not in text and "form number" in text


def fetch_uscis(session: requests.Session, url: str) -> bytes | None:
    """The body on HTTP 200 from www.uscis.gov, None otherwise"""
    try:
        response = session.get(url, timeout=TIMEOUT)
    except requests.RequestException as error:
        print(f"{url}: request failed: {error}")
        return None
    if response.status_code != 200:
        print(f"{url}: HTTP {response.status_code}")
        return None
    return response.content


def wayback_get(session: requests.Session, url: str, timeout: float = TIMEOUT) -> requests.Response | None:
    """GET from web.archive.org, retrying through its transient 5xx pages and
    resets; None when it fails, or at once when the archive has no capture."""
    for attempt in range(1, WAYBACK_ATTEMPTS + 1):
        try:
            response = session.get(url, timeout=timeout)
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


def save_page_now(session: requests.Session, url: str) -> str | None:
    """Ask the Wayback Machine to capture url now; the capture's timestamp,
    or None. Best effort: a failure is a warning."""
    try:
        response = session.get(SAVE_URL.format(url=url), timeout=SAVE_TIMEOUT, allow_redirects=False)
    except requests.RequestException as error:
        print(f"::warning::Save Page Now failed for {url}: {error}")
        return None
    location = response.headers.get("Location", "") or response.headers.get("Content-Location", "")
    match = re.search(r"/web/(\d{14})", location)
    if response.status_code not in (200, 302) or match is None:
        print(f"::warning::Save Page Now did not capture {url} (HTTP {response.status_code})")
        return None
    print(f"Save Page Now captured {url} as {match[1]}")
    return match[1]


def listed_reports(html: bytes) -> dict[str, str]:
    """The reports a listing page links to, as month -> URL"""
    listed: dict[str, str] = {}
    for link in BeautifulSoup(html, "lxml").find_all("a", href=True):
        match = LINK_TEXT.search(" ".join(link.get_text(" ").split()))
        if match is None:
            continue
        try:
            month = month_key(match["month"], match["year"])
        except ParseError:
            print(f"::warning::a report is listed for an unknown month: {link.get_text()!r}")
            continue
        listed.setdefault(month, urljoin(USCIS, str(link["href"])))
    return listed


def fetch_listing(session: requests.Session) -> dict[str, str] | None:
    """The reports USCIS's list links to, as month -> URL, or None when no
    source serves the list."""
    html = fetch_uscis(session, LISTING_URL)
    if html is None or not listed_reports(html):
        # blocked: have the archive fetch the list for us, so that a newly
        # published report is found the same day
        timestamp = save_page_now(session, LISTING_URL)
        response = (
            None if timestamp is None else wayback_get(session, WAYBACK_URL.format(timestamp=timestamp, url=LISTING_URL))
        )
        html = None if response is None else response.content
    listed = {} if html is None else listed_reports(html)
    if not listed:
        return None
    print(f"USCIS lists {len(listed)} monthly reports, the newest for {max(listed)}")
    return listed


def next_month(month: str) -> str:
    year, number = int(month[:4]), int(month[5:])
    return f"{year + number // 12}-{number % 12 + 1:02d}"


def fetch_report(session: requests.Session, url: str, month: str) -> bytes | None:
    """The report from uscis.gov or the Wayback Machine, or None when no
    source serves it."""
    content = fetch_uscis(session, url)
    if content is not None and looks_like_report(content):
        return content
    # the archive redirects to its capture nearest to the start of the month
    # after the report's, around when USCIS publishes it
    near = next_month(month).replace("-", "") + "01"
    response = wayback_get(session, WAYBACK_URL.format(timestamp=near, url=url))
    if response is not None and looks_like_report(response.content):
        return response.content
    timestamp = save_page_now(session, url)
    if timestamp is not None:
        response = wayback_get(session, WAYBACK_URL.format(timestamp=timestamp, url=url))
        if response is not None and looks_like_report(response.content):
            return response.content
    return None


def fetch(data: Data) -> int:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"})
    listed = fetch_listing(session)
    if listed is None:
        print("::warning::No source serves USCIS's list of monthly reports")
        return 0
    wanted = sorted(month for month in listed if month not in data["months"])
    print(f"Newest month in {DATA_PATH.name}: {max(data['months'], default='none')}; fetching {wanted}")

    added: list[str] = []
    problems: list[str] = []
    for month in wanted:
        content = fetch_report(session, listed[month], month)
        if content is None:
            print(f"::warning::No source serves the report for {month}: {listed[month]}")
            continue
        try:
            add_report(data, listed[month], content, month)
        except ParseError as error:
            problems.append(f"{month} ({listed[month]}): {error}")
            continue
        added.append(month)
        time.sleep(FETCH_DELAY_SECONDS)

    if added:
        save_data(data, DATA_PATH)
        print(f"Wrote {DATA_PATH}: added {', '.join(added)}")
        if len(added) <= MAX_SAVES:
            for month in added:
                save_page_now(session, data["months"][month]["url"])
    if problems:
        for problem in problems:
            print(f"::error::A monthly report was served but does not parse: {problem}", file=sys.stderr)
        return 1
    if not added:
        print(f"::notice::No new monthly report; the newest is {max(data['months'], default='none')}")
    return 0


# --- main ---------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fetch", action="store_true", help="fetch new reports (the default)")
    parser.add_argument("--from-file", type=Path, help="parse a report saved from a browser")
    parser.add_argument("--url", help="with --from-file: the address USCIS published it at")
    args = parser.parse_args()

    data = load_data(DATA_PATH)
    if args.from_file is None:
        return fetch(data)

    if args.url is None or not args.url.startswith(f"{USCIS}/"):
        parser.error(f"--from-file needs --url, the report's address on {USCIS}")
    try:
        content = args.from_file.read_bytes()
        month, _forms, _notes = parse_report(content)
        if month in data["months"]:
            print(f"{DATA_PATH.name} already has the report for {month}")
            return 0
        add_report(data, args.url, content)
    except (OSError, ParseError) as error:
        print(f"ERROR: {args.from_file}: {error}", file=sys.stderr)
        return 1
    save_data(data, DATA_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())
