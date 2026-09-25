"""Build forms.json: quarterly receipts, approvals, denials and pending
applications for every USCIS form, nationwide and (for the forms USCIS breaks
down that way) per field office.

USCIS publishes two kinds of quarterly reports on its Immigration and
Citizenship Data page, as CSV, PDF or (since FY2024) XLSX:

* "All USCIS Application and Petition Form Types": for every form (and for
  some, per category, e.g. I-130 immediate relatives vs. other relatives) the
  forms received, approved and denied in the quarter, the ones pending at its
  end and, since FY2022, USCIS's median processing time. Since FY2014.
* Per-office reports for N-400, I-485 and I-130 (all since FY2014): the same
  four counts per field office or service center,
  per category (I-130 immediate relatives vs. other relatives, I-485 family,
  employment, humanitarian and other, N-400 civilian vs. military) and in
  total.

Sources, in order:

1. www.uscis.gov directly. It sits behind Akamai, which answers HTTP 403 to
   non-browser clients most of the time.
2. The Wayback Machine, whose crawler *is* let through: the CDX index for the
   reports it already has, and Save Page Now for the listing page and for
   reports it has not captured yet, so a freshly published quarter still shows
   up here within a day.

Downloaded reports are cached in reports/ (gitignored, cached between
workflow runs) under their URL's path, so a report USCIS republishes under a
new name (a "_v2" or "_final" file) is downloaded rather than taken for the
one already cached; the parsed dataset is written to forms.json.

Exit codes: 0 when the dataset was (re)built; 1 when a report cannot be
fetched from any source or no longer parses (a layout change), so that the
workflow fails loudly instead of silently publishing a hole in the history.
Numbers that parse but look wrong (offices that do not add up to the report's
total, a national count far from the per-office report's) are printed as
GitHub Actions warnings instead, since USCIS's own reports have such defects.

`--offline` skips discovery and rebuilds the dataset from the cached reports
alone, for iterating on the parsers.
"""

from __future__ import annotations

import csv
import io
import json
import re
import sys
import time
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from dataclasses import field
from datetime import date
from datetime import timedelta
from itertools import pairwise
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.parse import urlsplit

import pdfplumber
import requests
from bs4 import BeautifulSoup
from openpyxl import load_workbook

HERE = Path(__file__).parent
REPORTS_DIR = HERE / "reports"
OUTPUT_PATH = HERE / "forms.json"

USCIS = "https://www.uscis.gov"
LISTING_URL = f"{USCIS}/tools/reports-and-studies/immigration-and-citizenship-data"
WAYBACK = "https://web.archive.org"
CDX_URL = f"{WAYBACK}/cdx/search/cdx"
DOCUMENT_DIRS = (
    "www.uscis.gov/sites/default/files/document/data/",
    "www.uscis.gov/sites/default/files/document/reports/",
)

TIMEOUT = 60
# (connect, read): CDX queries usually answer in 5-15 s but occasionally hang
CDX_TIMEOUT = (10, 90)
SAVE_TIMEOUT = 180
WAYBACK_ATTEMPTS = 6
# USCIS publishes a quarter's reports no sooner than this many days after the
# quarter ends (FY2026 Q3, which ended June 30, appeared in early September),
# so until then a failed discovery cannot have missed a new quarter.
EARLIEST_PUBLICATION_DAYS = 45

session = requests.Session()
session.headers.update(
    {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }
)


@dataclass(frozen=True)
class ReportFamily:
    """One series of quarterly reports."""

    # Which form's per-office reports these are, or None for the all-forms report
    form: str | None
    # Prefixes of the report file names (the CDX index matches them case-insensitively)
    file_prefixes: tuple[str, ...]
    # Full-text search on the listing page that finds the family's newest reports
    listing_query: str
    # Below this many rows, a report is considered misparsed
    min_rows: int
    # Per-office reports: the labels of the category column groups, each of
    # (Received, Approved, Denied, Pending), which a last "Total" group
    # follows. The CSV and XLSX reports name them in their header; the PDFs'
    # text layer does not keep the header's columns, so these are used there.
    categories: tuple[str, ...] = ()

    @property
    def groups(self) -> int:
        """Column groups per office row: the categories and the total."""
        return len(self.categories) + 1


FAMILIES = {
    "all_forms": ReportFamily(
        None,
        ("all_forms_performancedata", "quarterly_all_forms"),
        "All USCIS Application and Petition Form Types",
        30,
    ),
    "N-400": ReportFamily(
        "N-400",
        ("n400_perf",),
        "N-400 Naturalization",
        60,
        ("Naturalization", "Naturalization (Military)"),
    ),
    "I-130": ReportFamily(
        "I-130",
        ("i130_perf",),
        "I-130 Alien Relative",
        20,
        ("Immediate Relative", "All Other Relative"),
    ),
    "I-485": ReportFamily(
        "I-485",
        ("i485_perf",),
        "I-485 Adjustment of Status",
        60,
        (
            "Family-based",
            "Employment-based received at service center",
            "Humanitarian-based",
            "Others",
        ),
    ),
}
# The listing page also links a CSV next to most PDFs and, for FY2013 and
# earlier, reports with other names and layouts; those are not handled.
REPORT_FILENAME = re.compile(
    r"fy(?P<fy>\d{4}|\d{2})_?q(?:tr)?(?P<q>[1-4])(?:_final|_v\d+(?:\.\d+)?)?\.(?P<ext>xlsx|csv|pdf)$",
    re.IGNORECASE,
)
# When USCIS published a quarter in several formats, prefer the most structured one.
FORMAT_PRIORITY = {"xlsx": 0, "csv": 1, "pdf": 2}
# Reports for FY2013 and earlier have different names and layouts
MIN_FISCAL_YEAR = 2014
# Cache files of the layout before reports/ mirrored the URL paths
LEGACY_CACHE_NAME = re.compile(r"[a-z0-9_-]+_fy\d{4}q[1-4]\.(?:xlsx|csv|pdf)")

STATES = {
    "Alabama": "AL",
    "Alaska": "AK",
    "Arizona": "AZ",
    "Arkansas": "AR",
    "California": "CA",
    "Colorado": "CO",
    "Connecticut": "CT",
    "Delaware": "DE",
    "District of Columbia": "DC",
    "Florida": "FL",
    "Georgia": "GA",
    "Hawaii": "HI",
    "Idaho": "ID",
    "Illinois": "IL",
    "Indiana": "IN",
    "Iowa": "IA",
    "Kansas": "KS",
    "Kentucky": "KY",
    "Louisiana": "LA",
    "Maine": "ME",
    "Maryland": "MD",
    "Massachusetts": "MA",
    "Michigan": "MI",
    "Minnesota": "MN",
    "Mississippi": "MS",
    "Missouri": "MO",
    "Montana": "MT",
    "Nebraska": "NE",
    "Nevada": "NV",
    "New Hampshire": "NH",
    "New Jersey": "NJ",
    "New Mexico": "NM",
    "New York": "NY",
    "North Carolina": "NC",
    "North Dakota": "ND",
    "Ohio": "OH",
    "Oklahoma": "OK",
    "Oregon": "OR",
    "Pennsylvania": "PA",
    "Rhode Island": "RI",
    "South Carolina": "SC",
    "South Dakota": "SD",
    "Tennessee": "TN",
    "Texas": "TX",
    "Utah": "UT",
    "Vermont": "VT",
    "Virginia": "VA",
    "Washington": "WA",
    "West Virginia": "WV",
    "Wisconsin": "WI",
    "Wyoming": "WY",
    "American Samoa": "AS",
    "Guam": "GU",
    "Northern Mariana Islands": "MP",
    "Puerto Rico": "PR",
    "U.S. Virgin Islands": "VI",
    "Virgin Islands": "VI",
    "US Virgin Islands": "VI",
    "Washington, D.C.": "DC",
    "Washington DC": "DC",
}
STATES_BY_NORMALIZED_NAME = {
    re.sub(r"[^a-z]", "", name.lower()): name for name in STATES
}
# Office names the reports consistently misspell, and service centers, which
# the I-130 and I-485 reports list by their state's name alone
NAME_FIXES = {
    "OFM": "Fort Myers",
    "WSC": "California Service Center",
    "ESC": "Vermont Service Center",
    "NSC": "Nebraska Service Center",
    "SSC": "Texas Service Center",
    "YSC": "Potomac Service Center",
}
# The FY2014-FY2015 reports list the service centers under a "Service Center"
# heading by their state's name alone, without a code
SERVICE_CENTER_CODES = {
    "California": "WSC",
    "Vermont": "ESC",
    "Nebraska": "NSC",
    "Texas": "SSC",
    "Potomac": "YSC",
}
SERVICE_CENTER_HEADING = re.compile(r"^service\s*cent", re.IGNORECASE)
# Section headings, which some reports fill with zeros
HEADING = re.compile(r"^(?:field office|service cent)", re.IGNORECASE)
# Immigrant visas (a State Department form) and immigration court
# adjustments: not USCIS adjudications, and only reported since FY2026
SKIPPED_CATEGORIES = {"Supplemental Processing"}

# The form's name where the all-forms report has no row titled after the whole
# form: since FY2026 the I-131's rows are its categories, the largest of which
# is advance parole.
FORM_TITLES = {
    "I-131": "Application for Travel Documents, Parole Documents, and Arrival/Departure Records",
}
# A stable key for each category row of the forms the all-forms report splits
# into categories, by the row's title (compared ignoring case and spacing), so
# that a category keeps its history when USCIS retitles its row. A form's only
# row in a quarter is "all" unless listed here. The I-130 and I-765 rows from
# before USCIS split them by category ("all") cover every category and are
# deliberately not joined to any one of them.
VARIANT_KEYS: dict[str, dict[str, str]] = {
    "I-130": {
        "Immediate and Preference Relatives": "all",
        "Petition for Alien Relative": "all",
        "Petition for Alien Relative (Immediate Relative)": "immediate-relative",
        "Petition for Alien Relative (All Other Relative)": "all-other-relative",
    },
    "I-131": {
        "Reentry Permit/Refugee Travel Document": "travel-document",
        "Application for Travel Document": "travel-document",
        "Application for Travel Documents, Parole Documents, and Arrival/Departure Records": "travel-document",
        "Advance Parole": "advance-parole",
        "Application for Travel Document (Advance Parole)": "advance-parole",
        "Application for Advance Parole Document for Aliens Inside the United States": "advance-parole",
        "Application for Travel Document (Parole-in-Place)": "parole-in-place",
        "Application for Travel Document, Parole Documents, and Arrival/Departure Records (Parole in Place)": "parole-in-place",
        "Application for Travel Documents, Parole Documents, and Arrival/Departure Records (Parole in Place)": "parole-in-place",
        "Application for Travel Document (Humanitarian Parole)": "humanitarian-parole",
        "Application for Initial Parole Document for Aliens Outside the United States": "initial-parole",
    },
    "I-485": {
        "Family-Based Adjustments": "family",
        "Employment-Based Adjustments": "employment",
        "Asylum Adjustments": "asylum",
        "Refugee Adjustments": "refugee",
        "Cuban Adjustment Act": "cuban",
        "Indo Chinese Adjustments": "indo-chinese",
        "Other Adjustments of Status": "other",
        "Application to Register Permanent Residence or Adjust Status (Family)": "family",
        "Application to Register Permanent Residence or Adjust Status (Employment)": "employment",
        "Application to Register Permanent Residence or Adjust Status (Asylum)": "asylum",
        "Application to Register Permanent Residence or Adjust Status (Refugee)": "refugee",
        "Application to Register Permanent Residence or Adjust Status (Cuban)": "cuban",
        "Application to Register Permanent Residence or Adjust Status (Indo-Chinese)": "indo-chinese",
        "Application to Register Permanent Residence or Adjust Status (Other)": "other",
    },
    # Petitions filed before the EB-5 Reform and Integrity Act of 2022, which
    # USCIS has reported as "Legacy" since it split off standalone investors
    "I-526": {
        "Petitions by Entrepreneurs": "legacy",
        "Immigrant Petition by Alien Investor": "legacy",
        "Immigrant Petition by Alien Investor (Legacy)": "legacy",
        "Immigrant Petition by Standalone Investor": "standalone",
    },
    "I-765": {
        "Employment Authorization Documents": "all",
        "Application for Employment Authorization": "all",
        "Application for Employment Authorization (Asylum)": "asylum",
        "Application for Employment Authorization (Adjustment Of Status)": "adjustment-of-status",
        "Application for Employment Authorization (DACA)": "daca",
        "Application for Employment Authorization (All Other)": "all-other",
    },
    "N-400": {
        "Non-Military Naturalization": "civilian",
        "Application for Naturalization": "civilian",
        "Military Naturalization": "military",
        "Application for Naturalization (Military)": "military",
    },
}
# The per-office reports' categories, by a word of their label, first match
# first: (form, word, key)
OFFICE_CATEGORY_KEYS = (
    ("I-130", "immediate", "immediate-relative"),
    ("I-130", "other", "all-other-relative"),
    ("I-485", "family", "family"),
    ("I-485", "employment", "employment"),
    ("I-485", "humanitarian", "humanitarian"),
    ("I-485", "other", "other"),
    ("N-400", "military", "military"),
    ("N-400", "naturalization", "civilian"),
)
# National pending (all-forms report) vs. the per-office report's total, above
# which a quarter is flagged: the two reports come from separate queries and
# differ by up to 10% in a few quarters (I-130 in July-September 2019), but a
# misread report is further off (FY2024's fractional cells: 25%).
NATIONAL_VS_OFFICES_TOLERANCE = 0.15

FIELDS = ("received", "approved", "denied", "pending")
# "D" is a count withheld for privacy, "H" one withheld so "D" cannot be
# derived; a decimal is a count USCIS apportioned between categories
VALUE_TOKEN = re.compile(r"^(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|D|H|-|N/?A)?$")
NUMBER = re.compile(r"^(?:\d{1,3}(?:,\d{3})+|\d{1,3})$")
# A value, or a piece of one that PDF extraction split off ("1" ",925,486")
NUMBER_FRAGMENT = re.compile(r"^(?:[\d,]+|\d+\.\d+|D|H|-|N/?A)$")
DIGITS = re.compile(r"^[\d,.]+$")
OFFICE_CODE = re.compile(r"^[A-Z]{3}$")
# A "Received" column header (with its footnote digit), as opposed to the
# "Employment-based received at service center" category label above it
RECEIVED_HEADER = re.compile(r"\breceived\s*\d*$", re.IGNORECASE)
# A form number, possibly with a footnote digit or two glued on ("I-6007",
# "N-400 17"). I-90 is the only two-digit form, so "I-908" is I-90 with
# footnote 8 unless it is another form: see form_number().
FORM_KEY = re.compile(r"^(?P<form>[A-Z]{1,4}-\d{2,3}[A-Z]{0,2})\s*\d{0,2}$")
# The office name may itself contain a three-letter word ("Dover AFB DVD"); the
# code is the last one before the counts.
PDF_VALUES = r"(?P<values>(?:[\d,]+|D|H|-|N/?A)(?:\s+(?:[\d,]+|D|H|-|N/?A)){7,})"
PDF_OFFICE_LINE = re.compile(
    rf"^(?P<name>[A-Za-z][A-Za-z .'()-]*)\s+(?P<code>[A-Z]{{3}})\s+{PDF_VALUES}\s*$"
)
PDF_TOTAL_LINE = re.compile(r"^(?:Grand\s+)?Total\s+(?P<values>.+)$", re.IGNORECASE)
# Reports before FY2017 name the offices without a code
PDF_CODELESS_OFFICE_LINE = re.compile(
    rf"^(?P<name>[A-Za-z][A-Za-z .'()-]*?)\s+{PDF_VALUES}\s*$"
)
# What an office line that none of the above read looks like: a code and counts
PDF_UNREAD_OFFICE_LINE = re.compile(rf"\b[A-Z]{{3}}\s+{PDF_VALUES}\s*$")
PDF_FORM_LINE = re.compile(
    r"^(?P<form>[A-Z]{1,4}-\d{2,3}[A-Z]{0,2})(?:\s\d{1,2})?\s+(?P<rest>[A-Za-z(].*)$"
)


@dataclass(frozen=True, order=True)
class Report:
    family: str
    fiscal_year: int
    fiscal_quarter: int
    priority: int
    url: str

    @classmethod
    def from_url(cls, url: str) -> Report | None:
        url = canonical_url(url)
        parts = urlsplit(url)
        if parts.netloc != "www.uscis.gov" or ".." in parts.path:
            return None
        filename = parts.path.rsplit("/", 1)[-1].lower()
        family = next(
            (
                name
                for name, spec in FAMILIES.items()
                if filename.startswith(spec.file_prefixes)
            ),
            None,
        )
        match = REPORT_FILENAME.search(filename)
        if family is None or match is None:
            return None
        fiscal_year = int(match["fy"])
        fiscal_year += 2000 if fiscal_year < 100 else 0
        if fiscal_year < MIN_FISCAL_YEAR:
            return None
        return cls(
            family=family,
            fiscal_year=fiscal_year,
            fiscal_quarter=int(match["q"]),
            priority=FORMAT_PRIORITY[match["ext"].lower()],
            url=url,
        )

    @property
    def ext(self) -> str:
        return self.url.rsplit(".", 1)[-1].lower()

    @property
    def cache_path(self) -> Path:
        """The downloaded file: reports/ mirrors the URL's path, so every file USCIS publishes has its own."""
        return REPORTS_DIR / urlsplit(self.url).path.lstrip("/")

    @property
    def key(self) -> tuple[int, int]:
        return (self.fiscal_year, self.fiscal_quarter)

    @property
    def rank(self) -> tuple[bool, int, int, bool, int, str]:
        """How to choose among the files for one family and quarter, best (smallest) first.

        A complete report before a state-only or territory-only extract (for
        FY2023 Q3 USCIS published an I-130 report that ends at Wisconsin next
        to the complete one), a republished version ("_v2", "_v1.1") before
        the one it corrects, a "_final" before a draft, then the most
        structured format. The URL only breaks ties, so the choice is stable.
        """
        name = self.url.rsplit("/", 1)[-1].lower()
        version = re.search(r"_v(\d+)(?:\.(\d+))?\.\w+$", name)
        return (
            bool(re.search(r"_(?:state|territory)_", name)),
            -int(version[1]) if version else 0,
            -int(version[2] or 0) if version else 0,
            "_final" not in name,
            self.priority,
            self.url,
        )


def canonical_url(url: str) -> str:
    """A report's URL without its query, over https: the Wayback Machine has
    captured some files under http://, which must not pass for another file."""
    url = url.split("?")[0].split("#")[0]
    return re.sub(r"^http://", "https://", url, flags=re.IGNORECASE)


def best_reports(reports: list[Report] | set[Report]) -> list[Report]:
    """The best file (Report.rank) for each family and quarter, in chronological order per family."""
    candidates: dict[tuple[str, int, int], list[Report]] = defaultdict(list)
    for report in reports:
        candidates[(report.family, *report.key)].append(report)
    best = []
    for (family, fiscal_year, fiscal_quarter), group in sorted(candidates.items()):
        group.sort(key=lambda report: report.rank)
        chosen = group[0]
        others = [report for report in group[1:] if report.ext == chosen.ext]
        if others:
            print(
                f"{family} FY{fiscal_year} Q{fiscal_quarter}: using {chosen.url}, not {', '.join(r.url for r in others)}"
            )
        best.append(chosen)
    return sorted(best)


def calendar_quarter(fiscal_year: int, fiscal_quarter: int) -> tuple[str, date, date]:
    """(key like "2025-Q3", first day, last day) of a fiscal quarter's calendar quarter.

    Fiscal quarter 1 is October-December of the previous calendar year.
    """
    first_month = {1: 10, 2: 1, 3: 4, 4: 7}[fiscal_quarter]
    year = fiscal_year - 1 if fiscal_quarter == 1 else fiscal_year
    start = date(year, first_month, 1)
    end = (start.replace(day=28) + timedelta(days=4 + 31 * 2)).replace(
        day=1
    ) - timedelta(days=1)
    return f"{year}-Q{(first_month - 1) // 3 + 1}", start, end


@dataclass(frozen=True)
class Counts:
    """Received, approved, denied and pending; None for a count USCIS withheld or did not publish."""

    values: tuple[int | None, int | None, int | None, int | None]
    # Which of them USCIS withheld as too small to disclose ("D": where the
    # N-400 and I-485 offices add up to the report's total, the remainder
    # usually works out at 1 to 9 per "D"), as opposed to ones it did not
    # publish ("N/A", blank) or withheld so a "D" cannot be worked out ("H",
    # any size)
    withheld: frozenset[str] = frozenset()

    def __getitem__(self, index: int) -> int | None:
        return self.values[index]

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = dict(zip(FIELDS, self.values, strict=True))
        if self.withheld:
            result["withheld"] = [name for name in FIELDS if name in self.withheld]
        return result


@dataclass
class OfficeRow:
    state: str | None
    name: str
    code: str | None
    # the total over the report's categories
    counts: Counts
    # per category of the report (OfficeReport.categories), None where the
    # row has no numbers for it
    categories: list[Counts | None] = field(default_factory=list)


@dataclass
class OfficeReport:
    offices: list[OfficeRow]
    # Every "Total" row found: the grand total at the top, and in FY2017-FY2020
    # reports also a subtotal at the end of the international offices section.
    totals: list[OfficeRow]
    # The labels of the report's categories, without their footnote digits
    categories: list[str]

    @property
    def total(self) -> OfficeRow | None:
        """The report's grand total, or None when no trustworthy one was found.

        The grand total is the largest total row; it is dropped when it comes out
        smaller than the field offices it sums (a PDF whose digits split apart).
        """
        received_sum = sum(row.counts[0] or 0 for row in self.offices)
        candidates = [
            row for row in self.totals if (row.counts[0] or 0) >= 0.9 * received_sum
        ]
        return (
            max(candidates, key=lambda row: row.counts[0] or 0) if candidates else None
        )


@dataclass
class FormRow:
    """One line of an all-forms report, for one fiscal quarter."""

    fiscal_year: int
    fiscal_quarter: int
    form: str
    title: str
    category: str | None
    counts: Counts
    processing_time: float | None


# --- fetching -----------------------------------------------------------------


def fetch_wayback(
    url: str,
    params: dict[str, str] | None = None,
    timeout: float | tuple[float, float] = TIMEOUT,
    allow_redirects: bool = True,
) -> requests.Response:
    """GET a web.archive.org URL, retrying on the archive's frequent 429/5xx hiccups and resets."""
    for attempt in range(WAYBACK_ATTEMPTS):
        try:
            r = session.get(
                url, params=params, timeout=timeout, allow_redirects=allow_redirects
            )
            if r.status_code in (200, 302):
                return r
            reason = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            reason = repr(e)
        print(
            f"wayback attempt {attempt + 1}/{WAYBACK_ATTEMPTS} failed ({reason}): {url}"
        )
        if attempt < WAYBACK_ATTEMPTS - 1:
            time.sleep(5 * 2**attempt)
    raise RuntimeError(
        f"Wayback Machine did not serve {url} after {WAYBACK_ATTEMPTS} attempts"
    )


def wayback_captures(url_prefix: str) -> dict[str, str]:
    """Newest HTTP 200 capture timestamp of every archived URL starting with `url_prefix`."""
    # Not collapsed on urlkey: that keeps only each URL's *oldest* capture,
    # which would pin a report USCIS corrected in place to its first version.
    r = fetch_wayback(
        CDX_URL,
        {
            "url": f"{url_prefix}*",
            "output": "json",
            "fl": "timestamp,original",
            "filter": "statuscode:200",
        },
        timeout=CDX_TIMEOUT,
    )
    try:
        rows = r.json()
    except ValueError:
        # an empty answer, or the archive's "Temporarily Offline" page, both
        # with HTTP 200; no captures at all is "[]"
        raise RuntimeError(
            f"the Wayback Machine's CDX index answered without JSON for {url_prefix}"
        ) from None
    captures: dict[str, str] = {}
    for timestamp, original in rows[1:]:
        original = canonical_url(original)
        if timestamp > captures.get(original, ""):
            captures[original] = timestamp
    return captures


def fetch_capture(timestamp: str, url: str) -> bytes:
    """The unmodified (`id_`) body of one Wayback capture."""
    return fetch_wayback(f"{WAYBACK}/web/{timestamp}id_/{url}").content


def save_page_now(url: str) -> str | None:
    """Ask the Wayback Machine to capture `url` right now; the new capture's timestamp, or None."""
    print(f"asking the Wayback Machine to capture {url}")
    try:
        r = fetch_wayback(
            f"{WAYBACK}/save/{url}", timeout=SAVE_TIMEOUT, allow_redirects=False
        )
    except RuntimeError as e:
        print(f"::warning::{e}")
        return None
    match = re.search(r"/web/(\d{14})", r.headers.get("Location", "") or r.url)
    if match is None:
        print(f"::warning::Save Page Now did not return a capture for {url}")
        return None
    return match[1]


def looks_like(ext: str, content: bytes) -> bool:
    if ext == "xlsx":
        return content.startswith(b"PK")
    if ext == "pdf":
        return content.startswith(b"%PDF")
    text = content[:4000].decode("utf-8", errors="replace").lower()
    return "<html" not in text and "received" in text


def fetch_uscis(url: str, params: dict[str, str] | None = None) -> bytes | None:
    """GET a www.uscis.gov URL directly; None when Akamai blocks us."""
    try:
        r = session.get(url, params=params, timeout=TIMEOUT)
    except requests.RequestException as e:
        print(f"uscis.gov request failed ({e!r}): {url}")
        return None
    if r.status_code != 200:
        print(f"uscis.gov answered HTTP {r.status_code}: {url}")
        return None
    return r.content


def download_report(report: Report, captures: dict[str, str]) -> bytes:
    if report.cache_path.exists():
        return report.cache_path.read_bytes()
    print(f"downloading {report.url}")
    content = fetch_uscis(report.url)
    if content is None or not looks_like(report.ext, content):
        timestamp = captures.get(report.url) or save_page_now(report.url)
        if timestamp is None:
            raise RuntimeError(
                f"{report.url} is blocked and the Wayback Machine has no capture of it"
            )
        content = fetch_capture(timestamp, report.url)
    if not looks_like(report.ext, content):
        raise RuntimeError(f"{report.url} did not come back as a {report.ext} file")
    report.cache_path.parent.mkdir(parents=True, exist_ok=True)
    report.cache_path.write_bytes(content)
    return content


def legacy_cache() -> list[Path]:
    """The files cached under the old names ("i-130_fy2024q1.xlsx"), which did
    not say which of a quarter's files they were, so are not read any more."""
    if not REPORTS_DIR.is_dir():
        return []
    return [
        path
        for path in REPORTS_DIR.iterdir()
        if path.is_file() and LEGACY_CACHE_NAME.fullmatch(path.name)
    ]


# --- discovery ----------------------------------------------------------------


def listing_reports(html: bytes) -> set[Report]:
    soup = BeautifulSoup(html, "lxml")
    reports = set()
    for link in soup.find_all("a", href=True):
        href = str(link["href"])
        if href.startswith("/"):
            href = USCIS + href
        report = Report.from_url(href)
        if report is not None:
            reports.add(report)
    return reports


def listing_url(family: ReportFamily) -> str:
    return f"{LISTING_URL}?query={quote(family.listing_query)}&items_per_page=100"


def discover_reports() -> tuple[set[Report], dict[str, str]]:
    """Every report file found (see best_reports for the ones used) and the Wayback captures of report files."""
    captures: dict[str, str] = {}
    for directory in DOCUMENT_DIRS:
        for family in FAMILIES.values():
            for prefix in family.file_prefixes:
                captures.update(wayback_captures(f"https://{directory}{prefix}"))
    reports = {
        report for url in captures if (report := Report.from_url(url)) is not None
    }
    print(f"{len(reports)} report files in the Wayback Machine's index")

    for family in FAMILIES.values():
        url = listing_url(family)
        html = fetch_uscis(url)
        if html is None or not listing_reports(html):
            # The listing page is blocked too; have the archive fetch it for us
            # so newly published reports are discovered the same day.
            timestamp = save_page_now(url)
            html = fetch_capture(timestamp, url) if timestamp else None
        listed = listing_reports(html) if html else set()
        print(
            f"{family.listing_query!r}: {len(listed)} report files listed, {len(listed - reports)} new"
        )
        reports |= listed

    return reports, captures


# --- parsing helpers ----------------------------------------------------------


def parse_value(text: str) -> int | None:
    """One cell: a count, 0 for "-" (represents zero), None for withheld ("D", "H"), "N/A" and blanks.

    Since FY2024 some XLSX cells are fractions (USCIS apportions some counts
    between categories, e.g. 59172.344 I-131 advance parole approvals):
    they are rounded, not dropped.
    """
    text = text.strip().replace(",", "")
    if text == "-":
        return 0
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        return round(float(text))
    return None


def parse_counts(cells: list[str], *, dash_pending_unknown: bool = False) -> Counts | None:
    """Received, approved, denied and pending, or None when these cells are not a data row.

    With `dash_pending_unknown` (the all-forms report), a pending "-" in a
    quarter that received applications is unknown, not zero: USCIS puts "-"
    in the pending column of forms it keeps no pile of (the I-870 and I-899
    worksheets, the I-956G and I-956H), whose applications do not all get
    decided in the quarter they come in.
    """
    cells = [cell.strip() for cell in cells]
    if (
        len(cells) != 4
        or not any(cells)
        or not all(VALUE_TOKEN.match(c) for c in cells)
    ):
        return None
    received, approved, denied, pending = (parse_value(cell) for cell in cells)
    if dash_pending_unknown and cells[3] == "-" and received != 0:
        pending = None
    return Counts(
        (received, approved, denied, pending),
        frozenset(name for name, cell in zip(FIELDS, cells, strict=True) if cell == "D"),
    )


def parse_months(text: str) -> float | None:
    """A processing time in months; 0 and N/A both mean USCIS did not publish one."""
    try:
        months = float(text.strip().replace(",", ""))
    except ValueError:
        return None
    return months if months > 0 else None


def state_name(text: str) -> str | None:
    return STATES_BY_NORMALIZED_NAME.get(re.sub(r"[^a-z]", "", text.lower()))


def is_total_label(text: str) -> bool:
    return re.sub(r"[^a-z]", "", text.lower()) in (
        "total",
        "grandtotal",
        "totalallforms",
    )


def without_footnote(label: str) -> str:
    """A header label without the footnote number glued to it ("Immediate Relative1")."""
    return re.sub(r"\s*\d+$", "", label).strip()


def normalize_dashes(text: str) -> str:
    """Some reports write their zeros with a Unicode hyphen or dash."""
    return re.sub("[\u2010\u2011\u2012\u2013\u2014\u2212]", "-", text)


def restore_x(line: str) -> str:
    """The FY2020 Q2 I-130 PDF's text layer has every "x" replaced by "N/A"
    ("TeN/Aas", "PhoeniN/A PHO", "MEN/A"); a real "N/A" stands on its own."""

    def letter(match: re.Match[str]) -> str:
        before = line[match.start() - 1] if match.start() > 0 else ""
        return "x" if before.islower() else "X"

    return re.sub(r"(?<=[A-Za-z])N/A|N/A(?=[a-z])", letter, line)


def grid_of(report: Report, content: bytes) -> list[list[str]]:
    """A CSV or XLSX report as rows of stripped cell strings."""
    if report.ext == "csv":
        # The older CSVs are Windows-1252 ("Fiancé(e)" is the only non-ASCII text)
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("cp1252", errors="replace")
        rows = list(csv.reader(io.StringIO(text)))
    else:
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        rows = [
            ["" if cell is None else str(cell) for cell in row]
            for row in workbook.worksheets[0].iter_rows(values_only=True)
        ]
    return [[normalize_dashes(" ".join(cell.split())) for cell in row] for row in rows]


def pdf_lines(content: bytes) -> list[str]:
    """The text lines of a PDF, with the numbers its text layer split apart ("1" ",925,486") joined back.

    The fragments of one number touch (no horizontal gap between them), while
    words and columns are at least a couple of points apart.
    """

    def join(words: list[dict[str, Any]]) -> str:
        words = sorted(words, key=lambda word: word["x0"])
        text = words[0]["text"]
        for previous, word in pairwise(words):
            touching = word["x0"] - previous["x1"] < 1
            numeric = DIGITS.match(previous["text"]) and DIGITS.match(word["text"])
            text += ("" if touching and numeric else " ") + word["text"]
        return text

    lines: list[str] = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            line: list[dict[str, Any]] = []
            for word in sorted(page.extract_words(), key=lambda word: word["top"]):
                if line and word["top"] - line[0]["top"] > 3:
                    lines.append(join(line))
                    line = []
                line.append(word)
            if line:
                lines.append(join(line))
    return [restore_x(normalize_dashes(line.strip())) for line in lines]


def parse_addend(text: str) -> int | tuple[int, int]:
    """A value as a number, or as the (low, high) range a withheld/unavailable one may be."""
    value = parse_value(text)
    return value if value is not None else (0, 9)


def sums_to(addends: list[str], total: str) -> bool:
    """Whether `addends` can add up to `total`, given that withheld ("D") values are small."""
    if parse_value(total) is None:
        return True
    parsed = [parse_addend(a) for a in addends]
    low = sum(v if isinstance(v, int) else v[0] for v in parsed)
    high = sum(v if isinstance(v, int) else v[1] for v in parsed)
    return low <= (parse_value(total) or 0) <= high


def column_sums_to_total(values: list[str], groups: int, column: int) -> bool:
    """Whether, in one column (0 received ... 3 pending), a per-office row's category groups add up to its total group."""
    return sums_to(
        [values[4 * g + column] for g in range(groups - 1)],
        values[4 * (groups - 1) + column],
    )


def groups_sum_to_total(values: list[str], groups: int) -> bool:
    """A per-office row is consistent when, per column, the category groups add up to the total group."""
    return all(column_sums_to_total(values, groups, c) for c in range(4))


def rejoin_numbers(
    tokens: list[str],
    count: int,
    consistent: Callable[[list[str]], bool] = lambda values: True,
) -> list[str] | None:
    """Undo the digit splitting of PDF text ("1 ,925,486", "3 3,077") given how many values there must be.

    Adjacent tokens are merged wherever that is the only way to end up with
    `count` well-formed values that pass the `consistent` check (the report's
    own arithmetic); None when there is no way or more than one.
    """

    def solutions(tokens: list[str], count: int) -> list[list[str]]:
        if count == 0:
            return [[]] if not tokens else []
        if not tokens or len(tokens) < count:
            return []
        found: list[list[str]] = []
        for take in range(1, len(tokens) - count + 2):
            value = "".join(tokens[:take])
            if (
                VALUE_TOKEN.match(value)
                and value
                and not (take > 1 and not NUMBER.match(value))
            ):
                found.extend(
                    [value, *rest] for rest in solutions(tokens[take:], count - 1)
                )
                if len(found) > 500:
                    break
        return found

    if len(tokens) == count and consistent(tokens):
        return tokens
    found = [values for values in solutions(tokens, count) if consistent(values)]
    return found[0] if len(found) == 1 else None


def unsplit_tokens(tokens: list[str], count: int) -> bool:
    """Whether the tokens are already exactly `count` well-formed values, which
    is then the only way to read them: merging any two would leave too few."""
    return len(tokens) == count and all(
        token and VALUE_TOKEN.match(token) for token in tokens
    )


# --- per-office reports -------------------------------------------------------


def group_labels(grid: list[list[str]], header: int, starts: list[int]) -> list[str]:
    """The label of each column group: the nearest cell above the "Received" header row within the group's four columns ("Immediate Relative1", "Total")."""
    labels = []
    for start in starts:
        label = ""
        for row in reversed(grid[max(0, header - 4) : header]):
            if cells := [cell for cell in row[start : start + 4] if cell]:
                label = cells[0]
                break
        labels.append(without_footnote(label))
    return labels


def parse_office_grid(grid: list[list[str]]) -> OfficeReport:
    """Parse the CSV/XLSX layout: label columns, then per category (Received, Approved, Denied, Pending), the last category being the total."""
    header, starts = next(
        (
            (i, received)
            for i, row in enumerate(grid)
            if len(received := [j for j, c in enumerate(row) if RECEIVED_HEADER.search(c)])
            >= 2
        ),
        (None, []),
    )
    if header is None:
        raise ValueError("no header row with 'Received' columns")
    first_column = starts[0]
    labels = group_labels(grid, header, starts)
    if not is_total_label(labels[-1]):
        raise ValueError(f"the last column group is {labels[-1]!r}, not the total")

    offices: list[OfficeRow] = []
    totals: list[OfficeRow] = []
    state: str | None = None
    service_centers = False
    # the international offices (FY2017-FY2020), which are not USCIS field offices
    international = False
    for row in grid[header + 1 :]:
        cells = row + [""] * (starts[-1] + 4 - len(row))
        row_labels = cells[:first_column]
        code = next((c for c in row_labels if OFFICE_CODE.match(c)), None)
        names = [c for c in row_labels if c and c != code]
        if not names:
            continue
        name = names[-1]
        groups = [parse_counts(cells[start : start + 4]) for start in starts]
        counts = groups[-1]
        if counts is None:
            # A heading: a state, a country in the international offices
            # section, "Service Centers", or a label like "Field Office by
            # State". Only checked on rows without counts, as the Washington
            # field office (in DC) shares its name with the state.
            if row_labels[0]:
                state = state_name(name)
                service_centers = bool(SERVICE_CENTER_HEADING.match(name))
                international = international or "international" in name.lower()
            continue
        line = OfficeRow(state, name, code, counts, groups[:-1])
        if is_total_label(name):
            totals.append(line)
        elif code is not None:
            offices.append(line)
        elif service_centers and not row_labels[0]:
            # FY2014-FY2015: the service centers by their state's name alone
            offices.append(
                OfficeRow(None, name, SERVICE_CENTER_CODES.get(name), counts, groups[:-1])
            )
        elif row_labels[0] or state is None:
            # No office code and either the name sits in the state column or it
            # is under a country heading: an international office (code "N/A"
            # in later reports) or a stray line, not a field office.
            if row_labels[0] and state_name(name) is not None:
                state = state_name(name)
            elif not international and not HEADING.match(name) and any(counts.values):
                print(f"::warning::skipped a row that is not a known office: {row}")
        else:
            offices.append(line)
    return OfficeReport(offices, totals, labels[:-1])


def parse_office_pdf(content: bytes, family: ReportFamily) -> OfficeReport:
    """Parse the PDF layout from its text layer: one office per line, followed by its counts per category."""
    groups = family.groups
    count = 4 * groups
    offices: list[OfficeRow] = []
    totals: list[OfficeRow] = []
    state: str | None = None
    service_centers = False

    def values_of(line: str, text: str) -> list[Counts | None] | None:
        # Digits often come out split ("1 94,819"); the per-category counts
        # must add up to the total ones, which settles most of the ambiguity.
        tokens = text.split()
        values = rejoin_numbers(
            tokens, count, lambda values: groups_sum_to_total(values, groups)
        )
        if values is None and unsplit_tokens(tokens, count):
            # Nothing to rejoin, but the categories do not add up to the
            # total: a mistake in USCIS's arithmetic, or a withheld ("D")
            # count larger than usual. Kept when only one column is off.
            off = [c for c in range(4) if not column_sums_to_total(tokens, groups, c)]
            if len(off) == 1:
                print(
                    f"::warning::the categories' {FIELDS[off[0]]} do not add up to the total in {line!r}; kept as published"
                )
                values = tokens
        if values is None:
            return None
        return [parse_counts(values[4 * g : 4 * g + 4]) for g in range(groups)]

    for line in pdf_lines(content):
        if (match := PDF_TOTAL_LINE.match(line)) is not None:
            if (parsed := values_of(line, match["values"])) is not None and (
                total := parsed[-1]
            ) is not None:
                totals.append(OfficeRow(None, "Total", None, total, parsed[:-1]))
        elif (match := PDF_OFFICE_LINE.match(line)) is not None:
            if (parsed := values_of(line, match["values"])) is not None and (
                counts := parsed[-1]
            ) is not None:
                offices.append(
                    OfficeRow(state, match["name"], match["code"], counts, parsed[:-1])
                )
            else:
                print(f"::warning::cannot read the numbers of {line!r}")
        elif (match := PDF_CODELESS_OFFICE_LINE.match(line)) is not None and (
            service_centers or state is not None
        ):
            # Reports before FY2017: offices without codes, and service
            # centers by their state's name alone (checked before the state
            # headings, as "California 224 25,046 ..." would read as one)
            if (parsed := values_of(line, match["values"])) is not None and (
                counts := parsed[-1]
            ) is not None:
                name = match["name"]
                offices.append(
                    OfficeRow(None, name, SERVICE_CENTER_CODES.get(name), counts, parsed[:-1])
                    if service_centers
                    else OfficeRow(state, name, None, counts, parsed[:-1])
                )
            else:
                print(f"::warning::cannot read the numbers of {line!r}")
        elif (known_state := state_name(line)) is not None:
            state, service_centers = known_state, False
        elif re.fullmatch(r"[A-Za-z][A-Za-z .'&-]+", line):
            # a heading that is not a state: a country in the international
            # offices section, or "Service Center"
            state = None
            service_centers = bool(SERVICE_CENTER_HEADING.match(line))
        elif PDF_UNREAD_OFFICE_LINE.search(line):
            print(f"::warning::skipped a line that looks like an office: {line!r}")
    return OfficeReport(offices, totals, list(family.categories))


def parse_office_report(report: Report, content: bytes) -> OfficeReport:
    family = FAMILIES[report.family]
    parsed = (
        parse_office_pdf(content, family)
        if report.ext == "pdf"
        else parse_office_grid(grid_of(report, content))
    )
    if len(parsed.offices) < family.min_rows:
        raise ValueError(
            f"only {len(parsed.offices)} offices parsed from {report.url}; the layout must have changed"
        )
    if len(parsed.categories) != family.groups - 1:
        print(
            f"::warning::{report.url} has the categories {parsed.categories}, expected {list(family.categories)}"
        )
    # The offices should add up to the report's own total: they do not when
    # rows were skipped, or in USCIS's own defective reports (the scrambled
    # FY2017 Q1 service center rows).
    if (total := parsed.total) is not None:
        for index in (0, 3):
            expected = total.counts[index]
            summed = sum(row.counts[index] or 0 for row in parsed.offices)
            if expected and abs(summed - expected) > 0.1 * expected:
                print(
                    f"::warning::{report.url}: the offices' {FIELDS[index]} add up to {summed:,}, the report's total is {expected:,}"
                )
    return parsed


# --- the all-forms report -----------------------------------------------------


@dataclass
class ColumnGroup:
    fiscal_quarter: int
    received: int
    approved: int
    denied: int
    pending: int
    processing_time: int | None


def form_number(form: str, title: str) -> str:
    """The form number, with a footnote digit glued to "I-90" taken off: FY2016
    Q1 lists I-90 with footnote 8 as "I-908"."""
    if re.fullmatch(r"I-90\d", form) and "permanent resident card" in title.lower():
        return "I-90"
    return form


def all_forms_groups(
    grid: list[list[str]], report: Report
) -> tuple[list[ColumnGroup], int]:
    """The column groups of an all-forms CSV/XLSX and the index of the first data row.

    Until FY2019 Q2 a report had one group per quarter of the fiscal year so far
    (and a year-to-date group); since then it has the quarter and year-to-date.
    """
    # the column header row always has "Pending"; the rows above it hold the
    # group labels ("2nd Quarter") and split words ("Forms" / "Received")
    header_end = next(
        i for i, row in enumerate(grid) if any("pending" in c.lower() for c in row)
    )
    header_rows = grid[max(0, header_end - 3) : header_end + 1]
    width = max(len(row) for row in header_rows)
    labels = [
        " ".join(row[i].lower() for row in header_rows if i < len(row) and row[i])
        for i in range(width)
    ]
    starts = [i for i, label in enumerate(labels) if RECEIVED_HEADER.search(label)]
    # the cumulative layout has a group per quarter plus year-to-date, the
    # single-quarter one just the quarter and year-to-date
    cumulative = len(starts) >= 3
    groups = []
    for quarter, start in enumerate(starts[:4] if cumulative else starts[:1], 1):
        fiscal_quarter = quarter if cumulative else report.fiscal_quarter
        if fiscal_quarter > report.fiscal_quarter:
            break
        pending = next(i for i in range(start + 3, start + 6) if "pending" in labels[i])
        processing_time = next(
            (
                i
                for i in range(start + 3, start + 7)
                if i < width and "time" in labels[i]
            ),
            None,
        )
        groups.append(
            ColumnGroup(
                fiscal_quarter, start, start + 1, start + 2, pending, processing_time
            )
        )
    return groups, header_end + 1


def parse_all_forms_grid(report: Report, grid: list[list[str]]) -> list[FormRow]:
    groups, first_data_row = all_forms_groups(grid, report)
    first_column = groups[0].received
    rows: list[FormRow] = []
    category: str | None = None
    for row in grid[first_data_row:]:
        cells = row + [""] * (max(g.pending for g in groups) + 3 - len(row))
        labels = [c for c in cells[:first_column] if c]
        if not labels:
            continue
        # a form row is "I-130, title" or "Family Based, I-130, title"; a
        # category heading is a lone label without counts
        form_index, form_match = next(
            ((i, m) for i, c in enumerate(labels) if (m := FORM_KEY.match(c))),
            (None, None),
        )
        has_values = any(cells[first_column:])
        if form_match is None or form_index is None:
            if not has_values and not is_total_label(labels[0]):
                category = labels[0]
            continue
        if form_index > 0:
            category = labels[0]
        if category in SKIPPED_CATEGORIES:
            continue
        title = labels[form_index + 1] if len(labels) > form_index + 1 else ""
        for group in groups:
            counts = parse_counts(
                [
                    cells[group.received],
                    cells[group.approved],
                    cells[group.denied],
                    cells[group.pending],
                ],
                dash_pending_unknown=True,
            )
            if counts is None:
                continue
            rows.append(
                FormRow(
                    report.fiscal_year,
                    group.fiscal_quarter,
                    form_number(form_match["form"], title),
                    title,
                    category,
                    counts,
                    (
                        parse_months(cells[group.processing_time])
                        if group.processing_time is not None
                        else None
                    ),
                )
            )
    return rows


def parse_all_forms_pdf(report: Report, content: bytes) -> list[FormRow]:
    """The PDF layouts (FY2019 Q3 - FY2021 Q3), digits often split by spaces.

    Until FY2020 a report had cumulative fiscal-year columns (four per quarter
    so far, then year-to-date received and approved); from FY2021 it has the
    quarter (received, approved, denied, completions, pending, processing
    time) and, after the first quarter, the year-to-date (the same without
    processing time).
    """
    lines = pdf_lines(content)
    cumulative = not any("processing time" in line.lower() for line in lines[:8])
    quarters = report.fiscal_quarter
    value_count = 4 * quarters + 2 if cumulative else 6 if quarters == 1 else 11

    def consistent(values: list[str]) -> bool:
        if cumulative:
            # the year-to-date received and approved are the sums of the quarters'
            return all(
                sums_to(
                    [values[4 * q + c] for q in range(quarters)],
                    values[4 * quarters + c],
                )
                for c in range(2)
            )
        received, approved, denied, completions = (parse_value(v) for v in values[:4])
        if None not in (approved, denied, completions) and completions < approved + denied:  # type: ignore[operator]
            return False
        if quarters == 1:
            return True
        # the year-to-date received is at least the quarter's
        year_to_date = parse_value(values[6])
        return received is None or year_to_date is None or year_to_date >= received

    rows: list[FormRow] = []
    category: str | None = None
    for line in lines:
        match = PDF_FORM_LINE.match(line)
        if match is None:
            if re.fullmatch(
                r"[A-Za-z][A-Za-z &/]+", line
            ) and not line.lower().startswith("total"):
                category = line
            continue
        if category in SKIPPED_CATEGORIES:
            continue
        words = match["rest"].split()
        # the title is everything up to the first run of value-like tokens that reaches the end
        split = len(words)
        while split > 0 and NUMBER_FRAGMENT.match(words[split - 1]):
            split -= 1
        title = " ".join(words[:split])
        form = form_number(match["form"], title)
        tokens = words[split:]
        values = rejoin_numbers(tokens, value_count, consistent)
        if values is None and not cumulative and len(tokens) == value_count - 1:
            # a blank processing time
            values = rejoin_numbers(
                [*tokens[:5], "N/A", *tokens[5:]], value_count, consistent
            )
        if values is None and cumulative and unsplit_tokens(tokens, value_count):
            # Nothing to rejoin, but USCIS's year-to-date received or approved
            # is not the sum of its quarters: kept when only one of the two is off.
            off = [
                FIELDS[c]
                for c in range(2)
                if not sums_to(
                    [tokens[4 * q + c] for q in range(quarters)],
                    tokens[4 * quarters + c],
                )
            ]
            if len(off) == 1:
                print(
                    f"::warning::FY{report.fiscal_year} Q{report.fiscal_quarter}: the quarters' {off[0]} of {form} {title!r} do not add up to the year to date; kept as published"
                )
                values = tokens
        if values is None:
            print(
                f"::warning::FY{report.fiscal_year} Q{report.fiscal_quarter}: cannot read the numbers of {form} {title!r}: {' '.join(words[split:])}"
            )
            continue
        if not cumulative:
            counts = parse_counts(
                [values[0], values[1], values[2], values[4]],
                dash_pending_unknown=True,
            )
            if counts is not None:
                rows.append(
                    FormRow(
                        report.fiscal_year,
                        quarters,
                        form,
                        title,
                        category,
                        counts,
                        parse_months(values[5]),
                    )
                )
            continue
        for quarter in range(1, quarters + 1):
            counts = parse_counts(
                values[4 * (quarter - 1) : 4 * quarter], dash_pending_unknown=True
            )
            if counts is not None:
                rows.append(
                    FormRow(
                        report.fiscal_year,
                        quarter,
                        form,
                        title,
                        category,
                        counts,
                        None,
                    )
                )
    return rows


def parse_all_forms_report(report: Report, content: bytes) -> list[FormRow]:
    rows = (
        parse_all_forms_pdf(report, content)
        if report.ext == "pdf"
        else parse_all_forms_grid(report, grid_of(report, content))
    )
    current = [row for row in rows if row.fiscal_quarter == report.fiscal_quarter]
    if len(current) < FAMILIES["all_forms"].min_rows:
        raise ValueError(
            f"only {len(current)} form rows parsed from {report.url}; the layout must have changed"
        )
    return rows


# --- assembly -----------------------------------------------------------------


def normalize_name(name: str) -> str:
    name = re.sub(r"[^a-z ]", "", name.lower())
    name = re.sub(r"\b(saint|st)\b", "st", name)
    name = re.sub(r"\b(fort|ft)\b", "ft", name)
    return re.sub(r"\s+", " ", name).strip()


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def sum_counts(rows: list[Counts]) -> dict[str, Any]:
    """Per field, the sum of the rows that have it, or None when none does
    (withheld when some row withheld it as too small to disclose)."""
    result: dict[str, Any] = {}
    withheld = []
    for i, name in enumerate(FIELDS):
        values: list[int] = [v for row in rows if (v := row[i]) is not None]
        result[name] = sum(values) if values else None
        if not values and any(name in row.withheld for row in rows):
            withheld.append(name)
    if withheld:
        result["withheld"] = withheld
    return result


def base_title(title: str) -> str:
    """The title without its trailing category, e.g. "(Immediate Relative)"; "Fiancé(e)" is not one."""
    return re.sub(r"\s+\([^()]*(?:\([^()]*\)[^()]*)*\)\s*$", "", title) or title


def normalize_title(title: str) -> str:
    return re.sub(r"\s+", " ", title).strip().lower()


NORMALIZED_VARIANT_KEYS = {
    form: {normalize_title(title): key for title, key in keys.items()}
    for form, keys in VARIANT_KEYS.items()
}


def variant_keys(form: str, titles: list[str]) -> list[str]:
    """A stable key for each category row of a form in one quarter (see VARIANT_KEYS)."""
    known = NORMALIZED_VARIANT_KEYS.get(form, {})
    keys: list[str] = []
    for title in titles:
        key = known.get(normalize_title(title))
        if key is None:
            if len(titles) == 1:
                key = "all"
            else:
                category = re.search(
                    r"\s\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$", title
                )
                key = slugify(category[1] if category else title)
                print(
                    f"::warning::{form}: no category key for {title!r}, so {key!r}; add it to VARIANT_KEYS to keep the category's history joined across USCIS's renames"
                )
        if key in keys:
            unique = f"{key}-{slugify(title)}"
            print(
                f"::warning::{form}: two rows of one quarter have the category key {key!r}; {title!r} gets {unique!r}"
            )
            key = unique
        keys.append(key)
    return keys


def office_category_key(form: str, label: str) -> str:
    key = next(
        (
            key
            for key_form, word, key in OFFICE_CATEGORY_KEYS
            if key_form == form and word in label.lower()
        ),
        None,
    )
    if key is None:
        key = slugify(label)
        print(
            f"::warning::{form}: no category key for the per-office category {label!r}, so {key!r}; add it to OFFICE_CATEGORY_KEYS"
        )
    return key


def office_quarter(row: OfficeRow, keys: list[str]) -> dict[str, Any]:
    """An office's (or the report total's) counts, with its categories' when the report has several."""
    quarter = row.counts.as_dict()
    if len(keys) > 1:
        quarter["categories"] = {
            key: counts.as_dict()
            for key, counts in zip(keys, row.categories, strict=True)
            if counts is not None
        }
    return quarter


def build_offices(
    family: ReportFamily,
    reports: list[tuple[Report, OfficeReport]],
) -> tuple[
    list[dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[str, str],
    list[dict[str, str]],
]:
    """One form's office pages, its per-quarter totals, the report each quarter came from and the reports' categories."""
    assert family.form is not None
    # Reports before FY2017 name the offices without their codes; resolve those
    # names against every report that has both, most specific match first.
    codes_by_name: dict[tuple[str | None, str], str] = {}
    for _, parsed in reports:
        for row in parsed.offices:
            if row.code is not None:
                codes_by_name.setdefault(
                    (row.state, normalize_name(row.name)), row.code
                )
                codes_by_name.setdefault((None, normalize_name(row.name)), row.code)

    offices: dict[str, dict[str, Any]] = {}
    totals: dict[str, dict[str, Any]] = {}
    sources: dict[str, str] = {}
    # key -> label, the newest report's
    categories: dict[str, str] = {}
    for report, parsed in reports:
        quarter, _, _ = calendar_quarter(*report.key)
        labels = parsed.categories
        keys = [office_category_key(family.form, label) for label in labels]
        if len(set(keys)) != len(keys):
            # the quarter's totals are still good: only its categories go
            print(
                f"::warning::{report.url}: the categories {labels} are not told apart; left out"
            )
            keys, labels = [], []
        for key, label in zip(keys, labels, strict=True):
            categories.pop(key, None)
            categories[key] = label
        rows: list[OfficeRow] = []
        for row in parsed.offices:
            code = (
                row.code
                or codes_by_name.get((row.state, normalize_name(row.name)))
                or codes_by_name.get((None, normalize_name(row.name)))
            )
            if code is None:
                print(
                    f"::warning::{report.family} {quarter}: no office code known for {row.name!r} ({row.state}); skipped"
                )
                continue
            rows.append(row)
            # The newest report a code appears in names it; reports are in chronological order.
            office = offices.setdefault(code, {"code": code, "quarters": {}})
            office["name"] = NAME_FIXES.get(code, row.name)
            office["state"] = row.state
            office["quarters"][quarter] = office_quarter(row, keys)
        total = parsed.total
        if total is not None:
            totals[quarter] = office_quarter(total, keys)
        else:
            totals[quarter] = sum_counts([row.counts for row in rows])
            if len(keys) > 1:
                totals[quarter]["categories"] = {
                    key: sum_counts(
                        [c for row in rows if (c := row.categories[i]) is not None]
                    )
                    for i, key in enumerate(keys)
                }
        sources[quarter] = report.url

    for office in offices.values():
        state_code = STATES.get(office["state"]) if office["state"] else None
        office["stateCode"] = state_code
        office["slug"] = slugify(f"{office['name']} {state_code or ''}")
    slugs = [office["slug"] for office in offices.values()]
    if len(set(slugs)) != len(slugs):
        raise ValueError(
            f"duplicate office slugs: {sorted(s for s in slugs if slugs.count(s) > 1)}"
        )
    return (
        sorted(offices.values(), key=lambda office: office["code"]),
        totals,
        sources,
        [{"key": key, "label": label} for key, label in categories.items()],
    )


def check_national_vs_offices(entry: dict[str, Any]) -> None:
    """Warn when the all-forms report's pending count for a form is far from
    its per-office report's total: one of the two was misread (FY2024's
    fractional cells made the national I-485 count a third too low)."""
    for quarter, totals in sorted(entry["officeTotals"].items()):
        national = entry["quarters"].get(quarter, {}).get("pending")
        offices = totals.get("pending")
        if national and offices and abs(national / offices - 1) > NATIONAL_VS_OFFICES_TOLERANCE:
            print(
                f"::warning::{entry['form']} {quarter}: {national:,} pending nationwide in the all-forms report, {offices:,} in the per-office report"
            )


# Of the series (form categories) with a median in both a quarter and the
# one before, at least this share repeating the one before to the last digit
# means the report published the quarter before's medians again: the FY2024
# Q3 report (April-June 2024) repeated 37 of 44, against at most 4 of 38 in
# any other quarter since FY2021.
REPUBLISHED_MEDIAN_SHARE = 0.5
REPUBLISHED_MEDIAN_MIN_SERIES = 10


def drop_republished_medians(forms: dict[str, dict[str, Any]]) -> None:
    """Drop the medians of a quarter whose report repeats the quarter before's
    (REPUBLISHED_MEDIAN_SHARE): they say nothing about that quarter."""
    quarters = sorted({q for entry in forms.values() for q in entry["quarters"]})
    republished = []
    for previous, quarter in pairwise(quarters):
        same = compared = 0
        for entry in forms.values():
            before = {
                variant["key"]: variant["processingTime"]
                for variant in entry["quarters"].get(previous, {}).get("variants", [])
            }
            for variant in entry["quarters"].get(quarter, {}).get("variants", []):
                earlier = before.get(variant["key"])
                if variant["processingTime"] is None or earlier is None:
                    continue
                compared += 1
                same += variant["processingTime"] == earlier
        if (
            compared >= REPUBLISHED_MEDIAN_MIN_SERIES
            and same >= REPUBLISHED_MEDIAN_SHARE * compared
        ):
            republished.append(quarter)
    for quarter in republished:
        print(
            f"::warning::the {quarter} all-forms report repeats the quarter before's medians; not using them"
        )
        for entry in forms.values():
            for variant in entry["quarters"].get(quarter, {}).get("variants", []):
                variant["processingTime"] = None


def build_dataset(
    all_forms: list[tuple[Report, list[FormRow]]],
    office_reports: dict[str, list[tuple[Report, OfficeReport]]],
) -> dict[str, Any]:
    # Newer reports restate earlier quarters (the cumulative layout, and
    # post-adjudicative corrections); the newest report wins for each quarter.
    rows_by_quarter: dict[tuple[str, tuple[int, int]], list[FormRow]] = {}
    sources_by_quarter: dict[tuple[str, tuple[int, int]], str] = {}
    for report, rows in all_forms:
        for row in rows:
            key = (row.form, (row.fiscal_year, row.fiscal_quarter))
            if sources_by_quarter.get(key) != report.url:
                rows_by_quarter[key] = []
                sources_by_quarter[key] = report.url
            rows_by_quarter[key].append(row)

    forms: dict[str, dict[str, Any]] = {}
    for (form, fiscal), rows in sorted(
        rows_by_quarter.items(), key=lambda item: item[0][1]
    ):
        quarter, _, _ = calendar_quarter(*fiscal)
        entry = forms.setdefault(
            form, {"form": form, "slug": slugify(form), "quarters": {}, "sources": {}}
        )
        keys = variant_keys(form, [row.title for row in rows])
        entry["quarters"][quarter] = {
            **sum_counts([row.counts for row in rows]),
            "variants": [
                {
                    "key": key,
                    "title": row.title,
                    **row.counts.as_dict(),
                    "processingTime": row.processing_time,
                }
                for key, row in zip(keys, rows, strict=True)
            ],
        }
        entry["sources"][quarter] = sources_by_quarter[(form, fiscal)]
        # the newest report names and categorizes the form
        main = max(rows, key=lambda row: row.counts[0] or 0)
        entry["title"] = FORM_TITLES.get(form, base_title(main.title))
        entry["category"] = main.category
    drop_republished_medians(forms)

    for family_name, reports in office_reports.items():
        family = FAMILIES[family_name]
        assert family.form is not None
        offices, totals, sources, categories = build_offices(family, reports)
        entry = forms.setdefault(
            family.form,
            {
                "form": family.form,
                "slug": slugify(family.form),
                "quarters": {},
                "sources": {},
            },
        )
        entry["offices"] = offices
        entry["officeTotals"] = totals
        entry["officeSources"] = sources
        entry["officeCategories"] = categories
        check_national_vs_offices(entry)
    for entry in forms.values():
        entry.setdefault("offices", [])
        entry.setdefault("officeTotals", {})
        entry.setdefault("officeSources", {})
        entry.setdefault("officeCategories", [])
        entry.setdefault("title", entry["form"])
        entry.setdefault("category", None)

    # A form that drops out of the newest report stops having a page; say so,
    # as a misread form number ("I-908" for I-90) would look just like it.
    national_quarters = sorted({q for e in forms.values() for q in e["quarters"]})
    previous, newest = [None, None, *national_quarters][-2:]
    gone = sorted(
        e["form"]
        for e in forms.values()
        if previous in e["quarters"] and newest not in e["quarters"]
    )
    new = sorted(
        e["form"]
        for e in forms.values()
        if newest in e["quarters"] and previous not in e["quarters"]
    )
    if gone:
        print(
            f"::warning::{', '.join(gone)} in the {previous} report but not in the {newest} one (new in it: {', '.join(new) or 'none'})"
        )

    quarters = sorted(
        {
            q
            for entry in forms.values()
            for q in (*entry["quarters"], *entry["officeTotals"])
        }
    )
    periods = []
    for quarter in quarters:
        year, q = quarter.split("-Q")
        fiscal_year, fiscal_quarter = (
            (int(year) + 1, 1) if q == "4" else (int(year), int(q) + 1)
        )
        quarter_key, start, end = calendar_quarter(fiscal_year, fiscal_quarter)
        assert quarter_key == quarter
        periods.append(
            {
                "quarter": quarter,
                "start": start.isoformat(),
                "end": end.isoformat(),
                "fiscalYear": fiscal_year,
                "fiscalQuarter": fiscal_quarter,
            }
        )
    return {
        "periods": periods,
        "forms": sorted(forms.values(), key=lambda entry: entry["form"]),
    }


def cached_reports() -> set[Report]:
    """Every report file in the cache."""
    if not REPORTS_DIR.is_dir():
        return set()
    return {
        report
        for path in REPORTS_DIR.rglob("*")
        if path.is_file()
        and (
            report := Report.from_url(
                f"{USCIS}/{path.relative_to(REPORTS_DIR).as_posix()}"
            )
        )
        is not None
    }


def check_history(previous: dict[str, Any], dataset: dict[str, Any]) -> None:
    """Fail when the new dataset lost a quarter of a form the previous one
    had: the Wayback Machine's CDX index sometimes answers a query with only
    some of the files it has (on one run, none of FY2014-FY2016's all-forms
    reports), and USCIS does not withdraw published quarters. A form gone
    altogether is only warned about, as a misread form number ("I-908") goes
    that way when the parser is fixed."""
    new = {form["form"]: form for form in dataset["forms"]}
    lost = []
    for form in previous["forms"]:
        if form["form"] not in new:
            print(f"::warning::{form['form']} is no longer in {OUTPUT_PATH.name}")
            continue
        for field_name in ("quarters", "officeTotals"):
            missing = sorted(set(form[field_name]) - set(new[form["form"]][field_name]))
            if missing:
                lost.append(f"{form['form']} {field_name} {', '.join(missing)}")
    if lost:
        raise RuntimeError(
            f"quarters {OUTPUT_PATH.name} had are missing, so a report was not found: {'; '.join(lost)}"
        )


def new_quarter_due(today: date) -> bool:
    """Whether USCIS may have published a quarter newer than forms.json's newest."""
    newest = json.loads(OUTPUT_PATH.read_text())["periods"][-1]
    fiscal_year, fiscal_quarter = newest["fiscalYear"], newest["fiscalQuarter"] + 1
    if fiscal_quarter > 4:
        fiscal_year, fiscal_quarter = fiscal_year + 1, 1
    _key, _start, end = calendar_quarter(fiscal_year, fiscal_quarter)
    return today >= end + timedelta(days=EARLIEST_PUBLICATION_DAYS)


def cache_is_complete() -> bool:
    """Whether reports/ holds every report forms.json was built from."""
    dataset = json.loads(OUTPUT_PATH.read_text())
    urls = {
        url
        for form in dataset["forms"]
        for sources in (form["sources"], form["officeSources"])
        for url in sources.values()
    }
    return all(
        (report := Report.from_url(url)) is not None and report.cache_path.exists()
        for url in urls
    )


def to_json(dataset: dict[str, Any]) -> str:
    """forms.json as Prettier (the repository's pre-commit hook) formats it, so
    that the file this script writes and a reformatted commit of it are the
    same: indented, but with a short list of strings on one line."""
    text = json.dumps(dataset, indent=2, sort_keys=True)

    def one_line(match: re.Match[str]) -> str:
        items = [line.strip().rstrip(",") for line in match["items"].splitlines()]
        line = f"{match['head']}[{', '.join(items)}]"
        fits = len(line) + len(match["comma"]) <= 80
        return line + match["comma"] if fits else match[0]

    return re.sub(
        r'^(?P<head>[ ]*(?:"[^"\n]*": )?)\[\n(?P<items>(?:[ ]+"[^"\n]*",?\n)+)[ ]*\](?P<comma>,?)$',
        one_line,
        text,
        flags=re.MULTILINE,
    )


def main() -> int:
    captures: dict[str, str] = {}
    offline = "--offline" in sys.argv
    legacy = legacy_cache()
    if offline and legacy:
        print(
            f"::warning::{REPORTS_DIR} has reports cached under their old file names ({len(legacy)}), which are not read any more;"
            " run once without --offline to download them again"
        )
    # The cache holds every report used before, so a report that discovery
    # misses (the Wayback Machine's index is patchy) is still used.
    reports = cached_reports()
    if not offline:
        try:
            discovered, captures = discover_reports()
            reports |= discovered
        except RuntimeError as e:
            # The Wayback Machine is down. With no new quarter due and every
            # report forms.json was built from already cached, there is
            # nothing discovery could add, so this is no reason to fail.
            if new_quarter_due(date.today()) or not cache_is_complete():
                raise
            print(
                f"::warning::{e}; no new quarter is due yet and every report is cached, so {OUTPUT_PATH.name} is left as it is"
            )
            return 0
        # discovery works, so reports are downloaded again under their new
        # names as needed: the old files are of no use
        for path in legacy:
            path.unlink()
    all_forms: list[tuple[Report, list[FormRow]]] = []
    office_reports: dict[str, list[tuple[Report, OfficeReport]]] = defaultdict(list)
    for report in best_reports(reports):
        content = download_report(report, captures)
        if report.family == "all_forms":
            rows = parse_all_forms_report(report, content)
            all_forms.append((report, rows))
            current = sum(row.fiscal_quarter == report.fiscal_quarter for row in rows)
            print(
                f"all forms FY{report.fiscal_year} Q{report.fiscal_quarter} ({report.ext}): {current} form rows"
            )
        else:
            parsed = parse_office_report(report, content)
            office_reports[report.family].append((report, parsed))
            print(
                f"{report.family} FY{report.fiscal_year} Q{report.fiscal_quarter} ({report.ext}): {len(parsed.offices)} offices,"
                f" total {'from report' if parsed.total else 'summed'}"
            )
    dataset = build_dataset(all_forms, office_reports)
    if OUTPUT_PATH.exists():
        check_history(json.loads(OUTPUT_PATH.read_text()), dataset)
    OUTPUT_PATH.write_text(to_json(dataset) + "\n")
    print(
        f"wrote {OUTPUT_PATH}: {len(dataset['forms'])} forms over {len(dataset['periods'])} quarters"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
