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

Python code is checked with [pre-commit](https://pre-commit.com) (`pre-commit run --all-files`).
