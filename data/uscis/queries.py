from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from dataclasses import replace
from pathlib import Path

import httpx

FORMS_URL = "https://egov.uscis.gov/processing-times/api/forms"
SUBFORMS_BASE_URL = "https://egov.uscis.gov/processing-times/api/formtypes"
OFFICES_BASE_URL = "https://egov.uscis.gov/processing-times/api/formoffices"

HEADERS = {
    "Accept": "application/json",
    "Referer": "https://egov.uscis.gov/processing-times/",
}

form_descriptions = {}
subform_names = {}
subform_descriptions = {}
office_descriptions = {}


@dataclass
class Query:
    client = httpx.AsyncClient(headers=HEADERS)
    form: str | None = None
    subform: str | None = None
    office: str | None = None

    def to_json(self) -> tuple[str, str, str]:
        if self.form is None or self.subform is None or self.office is None:
            raise ValueError("Incomplete query")

        return (
            self.form,
            self.subform,
            self.office,
        )

    @classmethod
    async def expand_forms(cls) -> AsyncGenerator[Query, None]:
        resp = await cls.client.get(FORMS_URL)
        resp.raise_for_status()
        for form in resp.json()["data"]["forms"]["forms"]:
            form_descriptions[form["form_name"]] = form["form_description_en"]
            yield cls(form=form["form_name"])

    async def expand_subforms(self) -> AsyncGenerator[Query, None]:
        resp = await self.client.get(f"{SUBFORMS_BASE_URL}/{self.form}")
        resp.raise_for_status()
        for subform in resp.json()["data"]["form_types"]["subtypes"]:
            subform_names[subform["form_key"]] = subform["form_type"]
            subform_descriptions[subform["form_key"]] = subform[
                "form_type_description_en"
            ]
            yield replace(self, subform=subform["form_key"])

    async def expand_offices(self) -> AsyncGenerator[Query, None]:
        resp = await self.client.get(f"{OFFICES_BASE_URL}/{self.form}/{self.subform}")
        resp.raise_for_status()
        for office in resp.json()["data"]["form_offices"]["offices"]:
            office_descriptions[office["office_code"]] = office["office_description"]
            yield replace(self, office=office["office_code"])


async def main():
    dump_dir = Path(__file__).parent / "dump"
    queries = [
        office_query
        async for form_query in Query.expand_forms()
        async for subform_query in form_query.expand_subforms()
        async for office_query in subform_query.expand_offices()
    ]

    queries_file = (dump_dir / "queries.jsonl").open("w")
    for query in queries:
        queries_file.write(json.dumps(query.to_json()) + "\n")

    labels_output = {
        "forms": form_descriptions,
        "subforms": subform_names,
        "subforms_long": subform_descriptions,
        "offices": office_descriptions,
    }
    (dump_dir / "labels.json").write_text(
        json.dumps(labels_output, indent=2, sort_keys=True)
    )


if __name__ == "__main__":
    asyncio.run(main())
