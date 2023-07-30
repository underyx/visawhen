from __future__ import annotations

import asyncio
import json
import sqlite3
import ssl
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

import arrow
import httpx
import pandas as pd
import sqlite_diffable.cli

BASE_URL = "https://egov.uscis.gov/processing-times/api/processingtime"

HEADERS = {
    "Accept": "application/json",
    "Referer": "https://egov.uscis.gov/processing-times/",
}

# workaround for UNSAFE_LEGACY_RENEGOTIATION_DISABLED - https://stackoverflow.com/a/71646353
ssl_context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH)
ssl_context.options |= 0x4
client = httpx.AsyncClient(headers=HEADERS, verify=ssl_context)

db_path = Path(__file__).parent / "times.sqlite"
dump_dir = Path(__file__).parent / "dump"
if dump_dir.exists():
    sqlite_diffable.cli.load.callback(str(db_path), str(dump_dir), True)

conn = sqlite3.connect(db_path)
conn.execute(
    """
    CREATE TABLE IF NOT EXISTS times (
        form TEXT,
        subform TEXT,
        office TEXT,
        reported_date TEXT,
        processed_date TEXT,
        months_80p TEXT,
        months_100p TEXT,
        UNIQUE(form, subform, office, reported_date)
    )
    """
)


def get_months(range: dict[str, Any]) -> str:
    unit = range["unit"].removesuffix("s").lower()
    if unit == "year":
        return str(range["value"] * 12)
    elif unit == "month":
        return str(range["value"])
    elif unit == "week":
        return str(range["value"] / 4)
    elif unit == "day":
        return str(range["value"] / 30)
    else:
        raise ValueError(f"Unknown unit, {range['unit']=}")


async def yield_records(queries_file: Path) -> AsyncGenerator[dict[str, Any], None]:
    for line in queries_file.open("r").readlines():
        query = tuple(json.loads(line))
        form, subform, office = query
        url = f"{BASE_URL}/{form}/{office}/{subform}"
        print(f"fetching {url}")
        resp = await client.get(url)
        resp.raise_for_status()
        container = resp.json()["data"]["processing_time"]["subtypes"]
        if len(container) != 1:
            raise ValueError(
                f"Expected exactly one piece of data, got {len(container)=}"
            )
        data = container[0]

        if (
            not data.get("publication_date", "").strip()
            or not data.get("service_request_date", "").strip()
            or not data.get("range", [{}])[-1].get("value", 0.0)
            or not data.get("range", [{}])[0].get("value", 0.0)
        ):
            print(f"missing data, skipping: {data}")
            continue

        reported = arrow.get(data["publication_date"], "MMMM DD, YYYY")
        processed = arrow.get(data["service_request_date"], "MMMM DD, YYYY")

        if range_len := len(data["range"]) != 2:
            raise ValueError(f"Expected exactly two range datapoints, got {range_len=}")

        yield {
            "form": form,
            "subform": subform,
            "office": office,
            "months_80p": get_months(data["range"][-1]),
            "months_100p": get_months(data["range"][0]),
            "reported_date": str(reported.date()),
            "processed_date": str(processed.date()),
        }


async def main():
    times = pd.read_sql("SELECT * FROM times", conn).set_index(
        ["form", "subform", "office", "reported_date"]
    )
    records = yield_records(dump_dir / "queries.jsonl")
    times = pd.concat(
        [times, pd.DataFrame.from_records([record async for record in records])],
    )

    times.to_sql("times", conn, if_exists="replace", index=False)
    sqlite_diffable.cli.dump.callback(str(db_path), str(dump_dir), (), True)


if __name__ == "__main__":
    asyncio.run(main())
