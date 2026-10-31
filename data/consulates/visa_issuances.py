"""Download State's monthly visa issuance PDFs and read every table row from them.

Run from this directory (`uv run python visa_issuances.py`); writes all_months.pkl,
which baselines.py reads. When travel.state.gov, its mirror and the Wayback Machine
all fail to list the PDFs, it writes nothing and exits 0, so the workflow has nothing
to commit instead of failing or writing a partial dataset.
"""

from __future__ import annotations

import re
import time
from pathlib import Path
from typing import NamedTuple
from urllib.parse import unquote
from urllib.parse import urljoin

import arrow
import pandas as pd
import requests
from bs4 import BeautifulSoup
from joblib import Memory
from joblib import Parallel
from joblib import delayed
from pypdf import PdfReader

CWD = Path.cwd()
PDFS_DIR = CWD / "pdfs"
JOBLIB_CACHE_DIR = CWD / ".joblib_cache"
ALL_MONTHS_PATH = CWD / "all_months.pkl"

memory = Memory(JOBLIB_CACHE_DIR, verbose=0, compress=True)

TRAVEL_STATE_GOV = "https://travel.state.gov"
# State serves the same pages and PDFs from this host without Cloudflare in front of
# them. It is not advertised and could go away, so it is only the second choice.
STATE_MIRROR = "https://adoption.state.gov"
WAYBACK = "https://web.archive.org"
REQUEST_TIMEOUT = 60
# (connect, read) timeout for CDX index queries: they normally answer in 5-15 s but
# occasionally hang for minutes, and a retry is cheaper than waiting one out
CDX_TIMEOUT = (10, 30)

session = requests.Session()
session.headers["User-Agent"] = "visawhen-bot (+https://github.com/underyx/visawhen)"


def fetch_travel_state_gov(path: str) -> requests.Response:
    """GET a travel.state.gov path (or an absolute URL, e.g. on STATE_MIRROR) directly,
    TLS verification on.

    travel.state.gov sits behind Cloudflare, which answers HTTP 403 to automated
    clients; callers must check `status_code` instead of trusting the body.
    """
    url = path if path.startswith("https://") else f"{TRAVEL_STATE_GOV}{path}"
    return session.get(url, timeout=REQUEST_TIMEOUT)


def fetch_wayback(
    url: str,
    params: dict[str, str] | None = None,
    attempts: int = 5,
    timeout: float | tuple[float, float] = REQUEST_TIMEOUT,
) -> requests.Response:
    """GET a web.archive.org URL, retrying on the archive's frequent 429/5xx hiccups (and timeouts)."""
    for attempt in range(attempts):
        try:
            r = session.get(url, params=params, timeout=timeout)
            if r.status_code == 200:
                return r
            reason = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            reason = repr(e)
        print(f"wayback attempt {attempt + 1}/{attempts} failed ({reason}): {url}")
        time.sleep(5 * 2**attempt)
    raise RuntimeError(f"Wayback Machine did not serve {url} after {attempts} attempts")


def normalize_url(url: str) -> str:
    """Scheme-less, unquoted, lowercased URL, for matching listing links to CDX rows."""
    return unquote(url.split("://", 1)[-1]).lower()


def wayback_captures(url_pattern: str, **cdx_params: str) -> dict[str, tuple[str, str]]:
    """Newest HTTP 200 Wayback capture of every URL matching `url_pattern` (CDX API, `*` wildcard allowed).

    Returns {normalized URL: (timestamp, original URL)}.
    """
    r = fetch_wayback(
        f"{WAYBACK}/cdx/search/cdx",
        {
            "url": url_pattern.split("://", 1)[-1],
            "output": "json",
            "fl": "timestamp,original",
            "filter": "statuscode:200",
            **cdx_params,
        },
        timeout=CDX_TIMEOUT,
    )
    captures: dict[str, tuple[str, str]] = {}
    for timestamp, original in r.json()[1:] if r.text.strip() else []:
        key = normalize_url(original)
        if key not in captures or timestamp > captures[key][0]:
            captures[key] = (timestamp, original)
    return captures


def fetch_wayback_capture(timestamp: str, original: str) -> requests.Response:
    """GET the unmodified (`id_`) body of one Wayback capture."""
    return fetch_wayback(f"{WAYBACK}/web/{timestamp}id_/{original}")


IV_LISTING_PATH = "/content/travel/en/legal/visa-law0/visa-statistics/immigrant-visa-statistics/monthly-immigrant-visa-issuances.html"
NIV_LISTING_PATH = "/content/travel/en/legal/visa-law0/visa-statistics/nonimmigrant-visa-statistics/monthly-nonimmigrant-visa-issuances.html"


class PdfLink(NamedTuple):
    text: str  # whitespace-normalized link text, e.g. "March 2019 - IV Issuances by Post and Visa Class"
    url: str  # absolute URL


def pdf_links(url: str, html: str) -> list[PdfLink]:
    """The PDF links in the listing page's content body, with hrefs resolved against `url`."""
    content = BeautifulSoup(html, "lxml").select_one(".contentbody")
    if content is None:
        return []
    return [
        PdfLink(" ".join(link.get_text().split()), urljoin(url, str(link["href"])))
        for link in content.find_all("a", href=True)
        if str(link["href"]).endswith(".pdf")
    ]


def list_pdfs(path: str) -> tuple[list[PdfLink], int, str | None]:
    """Return (PDF links, live HTTP status, Wayback timestamp the links came from or None).

    Tries travel.state.gov first, then the same page on STATE_MIRROR; when both are
    blocked (non-200 or no PDF links), falls back to the newest good Wayback Machine
    capture of the travel.state.gov listing page, if there is one. The links point to
    the host whose page they came from.
    """
    status = 0
    for host in (TRAVEL_STATE_GOV, STATE_MIRROR):
        url = f"{host}{path}"
        try:
            r = fetch_travel_state_gov(url)
        except requests.RequestException as e:
            print(f"{host} failed ({e!r}) for {path}")
            continue
        links = pdf_links(url, r.text) if r.status_code == 200 else []
        if links:
            print(f"using {host} for {path}: {len(links)} PDF links")
            return links, r.status_code, None
        # keep travel.state.gov's status for the warning in main()
        status = status or r.status_code
        print(
            f"{host} returned HTTP {r.status_code} with {len(links)} PDF links for {path}"
        )

    print(f"trying the Wayback Machine for {path}")
    url = f"{TRAVEL_STATE_GOV}{path}"
    captures = wayback_captures(url, limit="-1")
    if not captures:
        return [], status, None
    timestamp, original = max(captures.values())
    links = pdf_links(url, fetch_wayback_capture(timestamp, original).text)
    print(f"using Wayback capture {timestamp} of {path}: {len(links)} PDF links")
    return links, status, timestamp


def urls_by_month(links: list[PdfLink]) -> dict[str, str]:
    """{"IV-2026-03": PDF URL, "NIV-2026-03": ...} for the by-post-and-class reports."""
    result = {}
    for link in links:
        # some titles use an en dash, e.g. "February 2021 \u2013 NIV ..."
        link_text = link.text.replace("\u2013", "-")

        month, _, category = link_text.partition(" - ")
        category = category.replace("Visa Cass", "Visa Class")  # lol

        if "NIV Issuances by Post and Visa Class" in category:
            kind = "NIV"
        elif "IV Issuances by Post and Visa Class" in category:
            kind = "IV"
        else:
            continue
        month_key = f"{kind}-{arrow.get(month, 'MMMM YYYY').format('YYYY-MM')}"
        result[month_key] = link.url
    return result


def download_pdf(
    month_key: str, url: str, captures: dict[str, tuple[str, str]] | None
) -> None:
    """Save one PDF to PDFS_DIR, from the Wayback Machine when `captures` (from
    wayback_captures()) is given."""
    outfile = PDFS_DIR / f"{month_key}.pdf"
    print(f"doin {outfile}")
    if captures is not None:
        try:
            timestamp, original = captures[normalize_url(url)]
        except KeyError:
            raise RuntimeError(
                f"{url} is listed but has no Wayback capture; refusing to build a dataset with holes"
            ) from None
        r = fetch_wayback_capture(timestamp, original)
    else:
        r = fetch_travel_state_gov(url)
        r.raise_for_status()
    if not r.content.startswith(b"%PDF"):
        raise RuntimeError(
            f"{r.url} did not return a PDF (HTTP {r.status_code}, {r.headers.get('content-type')})"
        )
    outfile.write_bytes(r.content)


# Every table row is "<Post> <Visa Class> <Issuances>" in the PDF's text layer, so pypdf
# can read it directly. camelot's lattice flavor rendered every page to a bitmap and found
# the table lines with OpenCV: ~0.5 s/page against ~5 ms/page here, i.e. an hour of CI for
# the ~14,000 pages. It also dropped the odd row (the last one of IV-2025-09 and of
# NIV-2023-12); this reads the same rows for every other PDF. The page header ("Immigrant
# Visa Issuances by Post ...") is sometimes glued onto the end of a row, hence the optional
# non-digit tail after the number.
ROW = re.compile(
    r"^(?P<post>.+?)\s+(?P<cls>[A-Z][A-Z0-9/-]*)\s+(?P<n>\d[\d,]*)(?:\D.*)?$"
)
HEADER_POST = "Post Visa Class"


@memory.cache
def parse_pdf(path: Path) -> pd.DataFrame:
    rows = []
    for page in PdfReader(str(path)).pages:
        for line in page.extract_text().splitlines():
            match = ROW.match(line.strip())
            if match is None:
                continue
            post = match["post"]
            if post == "GRAND" or post.startswith(HEADER_POST):
                continue
            rows.append((post, match["cls"], int(match["n"].replace(",", ""))))

    result = pd.DataFrame(rows, columns=["Post", "Visa Class", "Issuances"])
    result["Post"] = result["Post"].astype("string")
    result["Visa Class"] = result["Visa Class"].astype("string")
    result["Visa Type"] = path.name.split("-")[0]
    result["Month"] = pd.Timestamp(
        arrow.get(
            path.name.replace("NIV-", "").replace("IV-", "").replace(".pdf", "")
        ).format("YYYYMMDD")
    )
    # uint16 used to be enough, but Bogota's B1/B2 column is already at 63k+ a month
    result["Issuances"] = result["Issuances"].astype("uint32")
    return result[["Post", "Visa Type", "Visa Class", "Month", "Issuances"]]


def main() -> None:
    PDFS_DIR.mkdir(exist_ok=True)
    # baselines.py must not pick up an earlier run's file if this one stops early
    ALL_MONTHS_PATH.unlink(missing_ok=True)

    iv_links, iv_status, iv_wayback = list_pdfs(IV_LISTING_PATH)
    niv_links, niv_status, niv_wayback = list_pdfs(NIV_LISTING_PATH)
    if not iv_links or not niv_links:
        print(
            f"::warning::travel.state.gov returned HTTP {niv_status if iv_links else iv_status}; upstream is blocking automated access, leaving existing data unchanged"
        )
        return
    using_wayback = iv_wayback is not None or niv_wayback is not None

    urls = urls_by_month([*iv_links, *niv_links])
    missing = [key for key in urls if not (PDFS_DIR / f"{key}.pdf").exists()]
    print(f"{len(urls)} months listed, {len(missing)} not downloaded yet")

    captures: dict[str, tuple[str, str]] | None = None
    if using_wayback:
        captures = {}
        # one CDX query per PDF directory (5-15 s each, occasionally much slower), so
        # skipped entirely on the usual day when the restored pdfs/ cache is complete
        if missing:
            for directory in {url.rsplit("/", 1)[0] for url in urls.values()}:
                captures.update(wayback_captures(f"{directory}/*"))
            print(f"{len(captures)} files are available from the Wayback Machine")

    Parallel(n_jobs=4 if using_wayback else -1, prefer="threads")(
        delayed(download_pdf)(key, urls[key], captures) for key in missing
    )

    results = Parallel(n_jobs=-1, prefer="processes")(
        delayed(parse_pdf)(path.relative_to(CWD))
        for path in sorted(PDFS_DIR.glob("*.pdf"))
    )
    all_months = (
        pd.concat(results).sort_values("Month", kind="stable").reset_index(drop=True)
    )
    print(all_months[all_months["Issuances"] > 1000].head())
    all_months.to_pickle(ALL_MONTHS_PATH)

    budapest_marriage = (
        all_months.loc[all_months["Post"] == "Budapest"]
        .loc[all_months["Visa Class"].isin(["CR1", "IR1"])]
        .groupby("Month")["Issuances"]
        .sum()
    )
    print(budapest_marriage)


if __name__ == "__main__":
    main()
