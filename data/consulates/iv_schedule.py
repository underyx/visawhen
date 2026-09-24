"""Add a snapshot of State's IV Scheduling Status Tool to iv_schedule.json.

The tool lists, for each immigrant visa post, the month of documentarily
complete cases NVC is scheduling interviews for, in three columns: immediate
relatives, family preference and employment. State only ever shows its latest
monthly update, so every snapshot kept here is history nobody else keeps.

This script has no network code. Save the page from a browser and run

    uv run python iv_schedule.py --from-file page.html

It parses the page's single table, dates the snapshot by the page's "Last
Updated: September 23, 2026" line, and maps State's post names to the site's
post slugs (from consulates.sqlite, opened read-only). A snapshot date that
is already in iv_schedule.json is never overwritten.

Exit codes: 0 when the snapshot was added or was already there; 1 when the
page no longer parses, or a post name matches no site post slug (add it to
ALIASES), in which case nothing is written.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import TypedDict

from bs4 import BeautifulSoup

HERE = Path(__file__).parent
DATA_PATH = HERE / "iv_schedule.json"
DB_PATH = HERE / "consulates.sqlite"
SOURCE_URL = "https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/iv-wait-times.html"

HEADER = ["Post", "Employment Visa", "Preference Visa", "Relative Visa"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_PATTERN = re.compile(r"(?P<month>[A-Z][a-z]{2})-(?P<year>\d{2})")
LAST_UPDATED_PATTERN = re.compile(r"Last Updated:\s*(?P<date>[A-Z][a-z]+ \d{1,2}, \d{4})")
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


class Data(TypedDict):
    source: str
    snapshots: dict[str, Snapshot]


class ParseError(Exception):
    pass


def letters(text: str) -> str:
    return re.sub(r"[^a-z]", "", text.lower())


def parse_month(text: str) -> str | None:
    """'Feb-26' as '2026-02'; 'N/A' as None"""
    if text == "N/A":
        return None
    match = MONTH_PATTERN.fullmatch(text)
    if match is None or match["month"] not in MONTHS:
        raise ParseError(f"Unexpected month {text!r}")
    return f"20{match['year']}-{MONTHS.index(match['month']) + 1:02d}"


def parse_last_updated(text: str) -> str:
    dates = {match["date"] for match in LAST_UPDATED_PATTERN.finditer(text)}
    if len(dates) != 1:
        raise ParseError(f"Expected one 'Last Updated' date on the page, found {sorted(dates) or 'none'}")
    return datetime.strptime(dates.pop(), "%B %d, %Y").date().isoformat()


def parse_page(html: str) -> tuple[str, dict[str, tuple[str | None, str | None, str | None]]]:
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

    posts: dict[str, tuple[str | None, str | None, str | None]] = {}
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
    with closing(sqlite3.connect(f"{DB_PATH.resolve().as_uri()}?mode=ro", uri=True)) as connection:
        return [slug for (slug,) in connection.execute('SELECT "Post Slug" FROM post_slugs')]


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
    with path.open(encoding="utf-8") as data_file:
        data: Data = json.load(data_file)
    return data


def save_data(data: Data, path: Path) -> None:
    data["snapshots"] = {
        date: {slug: snapshot[slug] for slug in sorted(snapshot)}
        for date, snapshot in sorted(data["snapshots"].items())
    }
    with path.open("w", encoding="utf-8") as data_file:
        json.dump(data, data_file, indent=2, ensure_ascii=False)
        data_file.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from-file", type=Path, required=True, help="the tool's page, saved from a browser")
    parser.add_argument("--data", type=Path, default=DATA_PATH, help=f"the JSON to merge into (default: {DATA_PATH.name})")
    args = parser.parse_args()

    try:
        as_of, posts = parse_page(args.from_file.read_text(encoding="utf-8"))
    except ParseError as error:
        print(f"ERROR: {args.from_file} does not parse: {error}", file=sys.stderr)
        return 1
    print(f"{args.from_file}: {len(posts)} posts, last updated {as_of}")

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

    data = load_data(args.data)
    if as_of in data["snapshots"]:
        print(f"{args.data} already has the snapshot of {as_of}; leaving it as it is")
        return 0
    data["snapshots"][as_of] = {
        slugs[name]: {"name": name, "relative": relative, "preference": preference, "employment": employment}
        for name, (employment, preference, relative) in posts.items()
    }
    save_data(data, args.data)
    print(f"Added the snapshot of {as_of} to {args.data}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
