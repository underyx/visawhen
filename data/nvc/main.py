from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Literal

import arrow
import dns.resolver
import requests

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
Data = dict[TimeframeName, dict[str, int]]


DATA_PATH = Path("data.json")
with DATA_PATH.open() as data_file:
    data: Data = json.load(data_file)


# manually resolving domain name cause of https://github.community/t/cannot-resolve-travel-state-gov-hostname-in-github-actions-with-default-dns-server/180625
resolver = dns.resolver.Resolver()
resolver.nameservers = ["1.1.1.1", "8.8.8.8"]
ip_address = resolver.resolve("travel.state.gov", "A")[0].to_text()

# nosemgrep: python.requests.security.disabled-cert-validation.disabled-cert-validation
r = requests.get(
    f"https://{ip_address}/content/travel/en/us-visas/immigrate/nvc-timeframes.html",
    headers={"Host": "travel.state.gov"},
    timeout=300,
    verify=False,
)

for timeframe_name, pattern in PATTERNS.items():
    timeframe_data = data[timeframe_name]
    match = pattern.search(r.text.replace("\xa0", " "))
    if not match:
        continue
    as_of_date = arrow.get(match.group("as_of_date"), DATE_FORMATS)
    latest_date = arrow.get(match.group("latest_date"), DATE_FORMATS)

    timeframe_data[as_of_date.date().isoformat()] = (as_of_date - latest_date).days

with DATA_PATH.open("w") as data_file:
    json.dump(data, data_file, indent=2)
    data_file.write("\n")
