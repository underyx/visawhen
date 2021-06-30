from pathlib import Path
import arrow
import re
import json
import requests
from typing import Literal


TimeframeName = Literal["creation", "review", "inquiry"]


PATTERNS: dict[TimeframeName, re.Pattern] = {
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
Data = dict[TimeframeName, dict[str, int]]


DATA_PATH = Path("data.json")
with DATA_PATH.open() as data_file:
    data: Data = json.load(data_file)


r = requests.get(
    "https://travel.state.gov/content/travel/en/us-visas/immigrate/nvc-timeframes.html"
)

for timeframe_name, pattern in PATTERNS.items():
    timeframe_data = data[timeframe_name]
    match = pattern.search(r.text)
    if not match:
        continue
    as_of_date = arrow.get(match.group("as_of_date"), "D-MMM-YYYY")
    latest_date = arrow.get(match.group("latest_date"), "D-MMM-YYYY")

    timeframe_data[as_of_date.date().isoformat()] = (as_of_date - latest_date).days

with DATA_PATH.open("w") as data_file:
    json.dump(data, data_file, indent=2)
    data_file.write("\n")
