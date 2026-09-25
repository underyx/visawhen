# [visawhen.com](https://visawhen.com)

Data on US visa wait times at the National Visa Center and at US embassies/consulates, and on USCIS processing of every form, by field office where USCIS publishes it.

## How it works

The site is a static [Next.js](https://nextjs.org) export: `next build` renders every page (one per consulate and visa class, one per USCIS form and field office) to `out/`, which GitHub Actions deploys to Netlify and Cloudflare Workers on every push to `main`.

The data lives in this repository and is refreshed by scheduled workflows that commit their results and trigger a deploy:

| Data                     | Source                                       | Scraper                   | Output                                    |
| ------------------------ | -------------------------------------------- | ------------------------- | ----------------------------------------- |
| NVC wait times           | travel.state.gov's NVC timeframes page       | `data/nvc/main.py`        | `data/nvc/data.json`                      |
| Consulate visa issuances | the State Department's monthly issuance PDFs | `data/consulates/*.ipynb` | `data/consulates/dump/` (sqlite-diffable) |
| USCIS form processing    | USCIS's quarterly reports                    | `data/uscis/forms.py`     | `data/uscis/forms.json`                   |

## Running the site locally

You need Node.js (the version in `.node-version`), Yarn (bundled in `.yarn/releases`, so `yarn` just works) and [sqlite-diffable](https://github.com/simonw/sqlite-diffable) on your `PATH` (`pipx install sqlite-diffable` or `uv tool install sqlite-diffable`) to rebuild the consulates database from its dump.

```sh
yarn            # install dependencies
yarn dev        # rebuilds data/consulates/consulates.sqlite, then serves the site on http://localhost:3000
yarn build      # the static export, into out/
yarn lint       # eslint
yarn typecheck  # tsc
```

## Running the scrapers

Each scraper is its own [uv](https://docs.astral.sh/uv/) project under `data/`:

```sh
cd data/nvc && uv run python main.py
cd data/uscis && uv run python forms.py          # add --offline to reparse the cached reports only
cd data/consulates && uv run jupyter nbconvert --to script --stdout visa-issuances.ipynb | uv run python -
```

Both travel.state.gov and uscis.gov block most non-browser clients, so the scrapers fall back to the Wayback Machine; see the docstring at the top of each script for the details.

The interview queues on the consulate pages come from State's [IV Scheduling Status Tool](https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/iv-wait-times.html), which only ever shows its latest monthly update. Nothing fetches it automatically yet: save the page from a browser, then run `cd data/consulates && uv run python iv_schedule.py --from-file page.html` to add that update to `data/consulates/iv_schedule.json`.

The policy notices on the consulate and NVC pages (posts that paused or moved their visa services, visa suspensions by nationality) are written by hand in `data/policy.json`, each with its sources and the date someone last checked it against them (`lastChecked`). Re-check them about weekly: a page says an entry may be out of date once that date is more than 30 days old. `end` is the day an entry ended or is due to end, the first day it no longer applies: from that day the page says "Ended" instead of "Ends", the interview card gives State's months again once State publishes an update dated on or after that day, and 60 days later the page drops the entry. `"status": "reported"` marks an entry that has no State Department notice, and `"overridesSchedule": true` keeps the interview card from presenting State's month as a queue at the entry's posts. The build fails when an entry lacks its dates or sources, and warns when more than 5 entries have no end date.

Python code is checked with [pre-commit](https://pre-commit.com) (`pre-commit run --all-files`).
