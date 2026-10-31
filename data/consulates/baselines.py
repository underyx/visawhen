"""Turn the rows visa_issuances.py read from State's PDFs into the site's tables.

Run from this directory after visa_issuances.py (`uv run python baselines.py`). It
reads all_months.pkl, merges visa codes that stand for one category, writes
consulates.sqlite and dumps it to dump/ with sqlite-diffable. Without all_months.pkl
(visa_issuances.py stopped early) it changes nothing and exits 0.
"""

from __future__ import annotations

import gzip
import re
import shutil
import sqlite3
from pathlib import Path

import pandas as pd
import sqlite_diffable.cli

ALL_MONTHS_PATH = Path("all_months.pkl")
DB_PATH = "consulates.sqlite"
DUMP_DIR = Path("dump")


def classes(name: str, *codes: str) -> dict[str, str]:
    return dict.fromkeys(codes, name)


# Immigrant visa (IV) classes, keyed by the codes in State's PDFs. Until January 2021
# State reported principals and their families under separate codes (DV1 for the
# lottery winner, DV2 for the spouse, DV3 for a child); since then mostly one code per
# category (DV). Both eras map onto the categories State reports now, so that every
# series runs across the change. The old codes are listed in
# https://travel.state.gov/content/dam/visas/Statistics/Immigrant-Statistics/MonthlyIVIssuances/Immigrant%20Visa%20Symbols.pdf
# (C = conditional residence; X = exempt from the per-country limit; B = self-petition).
#
# Some of the new IV codes are also nonimmigrant (NIV) codes with another meaning: IV E1,
# E2 and E3 are the first three employment preferences, but NIV E1, E2 and E3 are treaty
# traders, treaty investors and Australian professionals; IV F1 is the first family
# preference, NIV F1 a student; IV T5 is an investor, NIV T5 a trafficking victim's
# sibling. Every IV category therefore gets a name that no NIV class uses, and the
# assertion below keeps it that way. Codes not listed here (IR5, SB1, GV1, ...) keep
# their own name; so does E4 (15 visas in 2021-22), which State's list does not define.
# A code that comes with and without a trailing 1, 2 or 3 (principal, spouse, child)
# belongs in one class here, or its series breaks where State switched between them.
IV_CLASSES = {
    **classes("CR1/IR1", "CR1", "IR1"),
    **classes("CR2/IR2", "CR2", "IR2"),
    **classes("IW", "IW", "IW1", "IW2"),
    # IB3, children of IB1 self-petitioners, is reported under IB1 since 2021: IB3 went
    # from about 200 a year to none just as IB1 went from about 35 to about 200.
    **classes("IB1", "IB1", "IB3"),
    **classes("DV", "DV", "DV1", "DV2", "DV3"),
    **classes("F1 (family)", "F1", "F11", "F12"),
    **classes(
        "F2A",
        *("F2A", "F21", "F22", "F23"),
        *("C2A", "C21", "C22", "C23"),
        *("FX", "FX1", "FX2", "FX3"),
        *("CX", "CX1", "CX2", "CX3"),
    ),
    **classes("F2B", "F2B", "F24", "F25", "C24", "C25"),
    **classes("F3", "F3", "F31", "F32", "F33", "C31", "C32", "C33"),
    **classes("F4", "F4", "F41", "F42", "F43"),
    **classes("EB-1", "E1", "E11", "E12", "E13", "E14", "E15"),
    **classes("EB-2", "E2", "E21", "E22", "E23"),
    **classes("EB-3", "E3", "E31", "E32", "E34", "E35"),
    **classes("EW", "EW", "EW3", "EW4", "EW5"),
    # EB-5 is one class, with the set-asides of the EB-5 Reform and Integrity Act of
    # 2022 counted in it: State's codes for those came in from August 2024 (NU and RU
    # unreserved, NR and RR rural, NH and RH high unemployment, RI infrastructure),
    # each with a 1, 2 or 3 for principal, spouse and child from February 2025. The
    # Visa Bulletin groups them the same way ("5th Unreserved (including C5, T5, I5,
    # R5, NU, RU)", "Rural (20%, including NR, RR)", ...), e.g.
    # https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin/2026/visa-bulletin-for-september-2026.html
    **classes(
        "EB-5",
        *(
            f"{code}{n}"
            for code in [
                "I5",
                "C5",
                "T5",
                "R5",
                "NU",
                "RU",
                "NR",
                "RR",
                "NH",
                "RH",
                "RI",
            ]
            for n in ["", "1", "2", "3"]
        ),
    ),
    **{
        f"{code}{n}": code
        for code in ["AM", "BC", "BX", "SD", "SE", "SI", "SK", "SQ", "SR"]
        for n in ["", "1", "2", "3"]
    },
    # Afghan special immigrants admitted as conditional permanent residents: one code
    # (CQ) from August 2021, then CQ1, CQ2 and CQ3 from July 2022. See
    # https://www.uscis.gov/save/whats-new/afghan-special-immigrant-conditional-permanent-resident-status-and-non-si-parolees
    **classes("CQ", "CQ", "CQ1", "CQ2", "CQ3"),
    **classes("SU", "SU", "SU2", "SU3", "SU5"),
    **classes("B2A", "B2A", "B21", "B22", "B23"),
    **classes("B2B", "B2B", "B24", "B25"),
}

# Nonimmigrant visa (NIV) classes: every code is its own class but these.
NIV_CLASSES = {
    **classes("B1/B2", "B1", "B2"),
    **classes("BBBCC/BBBCV", "BBBCC", "BBBCV"),
}


def slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[\s_]", "-", text)
    text = re.sub(r"[^\w-]", "", text)
    return text


# Descriptions for the classes this script names or merges are kept in the repository;
# the others come from a sheet the site's owner keeps.
VISA_DESCRIPTIONS_PATH = Path("visa_descriptions.csv")
VISA_DESCRIPTIONS_SHEET_URL = "https://docs.google.com/spreadsheets/d/1GLtqb3PVXFriG7lanunfYJrpUE7_e0_L-PEN2spBQbY/export?format=csv"

GROUP_KEYS = ["Post Slug", "Visa Class Slug"]


def merge_classes(all_months: pd.DataFrame) -> pd.DataFrame:
    """Map State's codes onto IV_CLASSES and NIV_CLASSES and posts onto one name each,
    and add the "Post Slug" and "Visa Class Slug" columns the pages are keyed by."""
    # A code with and without a trailing digit, such as CQ and CQ1, is one category that
    # State reported in one code, then apart for principals and their families (or the
    # other way round). Counted apart, its series stops where the other one starts.
    iv_codes = set(all_months.loc[all_months["Visa Type"] == "IV", "Visa Class"])
    split = sorted(
        f"{code}{digit}"
        for code in iv_codes
        for digit in "0123456789"
        if f"{code}{digit}" in iv_codes
        and IV_CLASSES.get(f"{code}{digit}", f"{code}{digit}")
        != IV_CLASSES.get(code, code)
    )
    if split:
        print(
            f"::warning::the immigrant visa codes {split} are counted apart from the same code without the last digit: map both onto one class in IV_CLASSES"
        )

    all_months["Visa Class"] = (
        all_months["Visa Class"]
        .replace(IV_CLASSES)
        .where(
            all_months["Visa Type"] == "IV",
            all_months["Visa Class"].replace(NIV_CLASSES),
        )
    )
    types_per_class = all_months.groupby("Visa Class")["Visa Type"].nunique()
    shared = sorted(types_per_class.index[types_per_class > 1])
    assert not shared, (
        f"immigrant and nonimmigrant visas share the classes {shared}: give the immigrant ones their own name in IV_CLASSES"
    )

    all_months["Post"] = all_months["Post"].replace(
        to_replace={
            "AIT Taipei": "Taipei",
            "Dar Es Salaam": "Dar es Salaam",
            "Mumbai (Bombay)": "Mumbai",
            "Guatemala": "Guatemala City",
            "Panama": "Panama City",
            "Kuwait": "Kuwait City",
            "Port Au Prince": "Port-au-Prince",
            "Port Of Spain": "Port of Spain",
            "Rio De Janeiro": "Rio de Janeiro",
            "Tijuana Tpf": "Tijuana",
            "Chennai ( Madras)": "Chennai",
            "Chennai (Madras)": "Chennai",
            # Kazakhstan's capital was called Nur-Sultan from 2019 to 2022, and the
            # embassy's rows carry that name for exactly those months.
            "Nur-Sultan": "Astana",
            # Belize's embassy is in Belmopan; "Belize" has one month of rows (11 visas).
            "Belize": "Belmopan",
        }
    )
    all_months = all_months.groupby(
        ["Post", "Visa Type", "Visa Class", "Month"], as_index=False, sort=False
    )["Issuances"].sum()
    all_months["Post Slug"] = all_months["Post"].apply(slugify)
    all_months["Visa Class Slug"] = all_months["Visa Class"].apply(slugify)
    print(all_months)
    return all_months


def write_slugs(all_months: pd.DataFrame, conn: sqlite3.Connection) -> None:
    """The post_slugs and visa_slugs tables: names and descriptions by slug."""
    post_slugs = pd.DataFrame(
        all_months[["Post Slug", "Post"]].drop_duplicates().set_index("Post Slug")
    )
    post_slugs.to_sql("post_slugs", conn, if_exists="replace")

    visa_slugs = pd.DataFrame(
        all_months[["Visa Class Slug", "Visa Class", "Visa Type"]]
        .drop_duplicates()
        .set_index("Visa Class Slug")
    )
    duplicated = sorted(set(visa_slugs.index[visa_slugs.index.duplicated()]))
    assert not duplicated, f"these slugs stand for more than one class: {duplicated}"

    committed_descriptions = pd.read_csv(
        VISA_DESCRIPTIONS_PATH, index_col="Visa Class Slug"
    )["Description"]
    unused = sorted(committed_descriptions.index.difference(visa_slugs.index))
    if unused:
        print(f"::warning::{VISA_DESCRIPTIONS_PATH} describes unknown classes {unused}")
    sheet_descriptions = pd.read_csv(
        VISA_DESCRIPTIONS_SHEET_URL, index_col="Visa Class Slug"
    )["Description"]
    visa_slugs["Description"] = committed_descriptions.combine_first(
        sheet_descriptions
    ).reindex(visa_slugs.index)
    visa_slugs.to_sql("visa_slugs", conn, if_exists="replace")
    print(visa_slugs)


def write_backlogs(all_months: pd.DataFrame, conn: sqlite3.Connection) -> None:
    """The backlogs table: issuances per post, visa class and month."""
    all_months_range = pd.date_range(
        start=all_months["Month"].min(),
        end=all_months["Month"].max(),
        freq="MS",
        name="Month",
    )
    # A row per (post, visa class) in first-seen order and a column per month of the
    # whole period, 0 where the PDFs had no row.
    group_order = all_months.drop_duplicates(GROUP_KEYS).set_index(GROUP_KEYS).index
    issuances_wide = (
        all_months.pivot_table(
            index=GROUP_KEYS,
            columns="Month",
            values="Issuances",
            aggfunc="sum",
            fill_value=0,
        )
        .reindex(index=group_order, columns=all_months_range, fill_value=0)
        .astype("int64")
    )
    # The table keeps the name it had when it also held a pre-COVID backlog estimate;
    # the site and data/freshness.py read it as "backlogs".
    backlogs = (
        issuances_wide.stack()  # noqa: PD013 - melt would drop the index
        .rename("Issuances")
        .to_frame()
    )
    # A sample for the log; isin() rather than loc[], which fails once a pair is gone
    print(
        issuances_wide[
            issuances_wide.index.isin([("manila", "eb-3"), ("budapest", "cr1ir1")])
        ].iloc[:, -6:]
    )
    backlogs.to_sql("backlogs", conn, if_exists="replace")
    # The 2017-2020 averages the pages no longer compare against
    conn.execute("DROP TABLE IF EXISTS baselines")
    conn.commit()


def dump() -> None:
    """Write every table of DB_PATH to DUMP_DIR, the committed copy of the data."""
    for stale in DUMP_DIR.glob("baselines.*"):
        stale.unlink()
    sqlite_diffable.cli.dump.callback(
        DB_PATH, str(DUMP_DIR), tables=(), all=True, exclude=()
    )

    # The backlogs table is 1.3M+ rows and its plain ndjson dump passed GitHub's
    # 100 MB file limit, so that one file is committed gzipped (~11x smaller);
    # `bun run ensure-db` reads it gzipped. The header carries no name or
    # mtime so identical data produces identical bytes and no spurious commits.
    backlogs_dump = DUMP_DIR / "backlogs.ndjson"
    with (
        backlogs_dump.open("rb") as ndjson,
        backlogs_dump.with_suffix(".ndjson.gz").open("wb") as gz_file,
        gzip.GzipFile(
            filename="", mode="wb", fileobj=gz_file, compresslevel=9, mtime=0
        ) as gz,
    ):
        shutil.copyfileobj(ndjson, gz, 1 << 20)
    backlogs_dump.unlink()


def main() -> None:
    # visa_issuances.py only writes this file once it managed to fetch the upstream
    # PDFs (directly or via the Wayback Machine). Without it there is nothing new to
    # compute, and the committed dump stays untouched.
    if not ALL_MONTHS_PATH.exists():
        print(
            "::warning::all_months.pkl is missing because visa_issuances.py stopped early; upstream is blocking automated access, leaving existing data unchanged"
        )
        return
    all_months = merge_classes(pd.read_pickle(ALL_MONTHS_PATH))
    conn = sqlite3.connect(DB_PATH)
    write_slugs(all_months, conn)
    write_backlogs(all_months, conn)
    conn.close()
    dump()


if __name__ == "__main__":
    main()
