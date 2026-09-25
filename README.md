# [visawhen.com](https://visawhen.com)

Data on US visa wait times at the National Visa Center and at US embassies/consulates, and on USCIS processing of every form, by field office where USCIS publishes it.

## How it works

The site is a static [Next.js](https://nextjs.org) export: `next build` renders every page (one per consulate and visa class, one per USCIS form and field office) to `out/`, which GitHub Actions deploys to Netlify and Cloudflare Workers on every push to `main`.

The data lives in this repository and is refreshed by scheduled workflows that commit their results and trigger a deploy:

| Data                       | Source                                       | Scraper                                  | Output                                    |
| -------------------------- | -------------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| NVC wait times             | State's NVC timeframes page                  | `data/nvc/main.py`                       | `data/nvc/data.json`                      |
| Consulate interview queues | State's IV Scheduling Status Tool            | `data/consulates/iv_schedule.py --fetch` | `data/consulates/iv_schedule.json`        |
| Consulate visa issuances   | the State Department's monthly issuance PDFs | `data/consulates/*.ipynb`                | `data/consulates/dump/` (sqlite-diffable) |
| USCIS form processing      | USCIS's quarterly reports                    | `data/uscis/forms.py`                    | `data/uscis/forms.json`                   |

The NVC and interview-queue scrapers run in the same workflow (`nvc_update_schedule.yml`), daily and hourly on Mondays; the others run daily.

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
cd data/consulates && uv run jupyter nbconvert --to script --stdout baselines.ipynb | uv run python -
cd data/consulates && uv run python iv_schedule.py --fetch   # or --from-file page.html, for a page saved from a browser
```

### Where the State Department data comes from

travel.state.gov sits behind Cloudflare, which answers scripts with a 403 challenge page. The State Department scrapers therefore try, in order:

1. the page on travel.state.gov;
2. the same path on adoption.state.gov, which serves the same pages and PDFs without Cloudflare in front of it. It is not advertised and could go away, which is why it is not the first choice;
3. the Wayback Machine: the NVC and interview-queue scrapers look for captures of the page on either host, the issuance notebook for captures of the travel.state.gov listing page only.

They identify themselves with the user agent `visawhen-bot (+https://github.com/underyx/visawhen)`. Every reading is keyed by the date on the page itself ("As of 21-Sep-26", "Last Updated: September 23, 2026"), and a date already in the data is never overwritten, so a stale copy cannot replace newer data. After a run that added data, the NVC and interview-queue scrapers ask the Wayback Machine to capture the pages (Save Page Now), so the last fallback has something to fall back to; only then, not after every fetch, since the NVC workflow runs about 30 times on a Monday and an unchanged page needs no new capture. uscis.gov blocks scripts too; `forms.py` falls back to the Wayback Machine. See the docstring at the top of each script for the details.

The interview queues come from State's [IV Scheduling Status Tool](https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/iv-wait-times.html), which only ever shows its latest monthly update, so every snapshot in `data/consulates/iv_schedule.json` is history nobody else keeps. The snapshots before September 2026 were recovered from Wayback Machine captures of the tool, with `--from-file`. `--fetch` adds a snapshot only when State's update is newer than the newest one there, and refuses (and fails) a page that lists far fewer posts than the newest snapshot, such as a truncated one, since the site reads only the newest snapshot; a page older than the newest snapshot or more than 45 days old may be a stale copy, so it then tries the next source too. `--from-file` adds any update it does not have yet, whatever it lists.

### Stale data alerts

A scraper that finds nothing new, or cannot reach its source, still finishes green. The daily `freshness.yml` workflow runs `data/freshness.py`, which compares each source's newest date with how often it publishes (NVC weekly, the interview-queue tool monthly, USCIS quarterly and State's issuance statistics with a lag of several months). For each source that is overdue it opens one issue labelled `stale-data`, keeps it up to date while the data stays stale and closes it when new data arrives. `python3 data/freshness.py` prints the same report locally.

GitHub disables scheduled workflows in a public repository after 60 days without activity, and data commits can stop for longer than that. The same workflow keeps the scheduled workflows enabled through the Actions API instead of committing anything: every day it calls the enable endpoint for each one that is enabled or that GitHub disabled for inactivity, as keepalive-workflow's API mode does. A workflow disabled by hand (Actions, the workflow, "Disable workflow") is left alone and stays disabled until someone enables it again.

The policy notices on the consulate and NVC pages (posts that paused or moved their visa services, visa suspensions by nationality) are written by hand in `data/policy.json`, each with its sources and the date someone last checked it against them (`lastChecked`). Re-check them about weekly: a page says an entry may be out of date once that date is more than 30 days old. `end` is the day an entry ended or is due to end, the first day it no longer applies: from that day the page says "Ended" instead of "Ends", the interview card gives State's months again once State publishes an update dated on or after that day, and 60 days later the page drops the entry. `start` is the day it took effect: an entry announced ahead of time is not shown or applied before then. `"status": "reported"` marks an entry that has no State Department notice; publish one only when at least two independent reputable sources report it. `"overridesSchedule": true` keeps the interview card from presenting State's month as a queue at the entry's posts. `scope` names post slugs (`posts`), every consulate page (`allConsulatePages`), posts left out of that (`exceptPosts`, for instance where a worldwide pause is reported to have ended) or other pages by path (`pages`, currently only `/nvc`). On the consulate pages, the entries about the post itself are shown in full and the rest collapsed, with their titles listed. The build fails when an entry lacks its dates or sources or names a page that shows no notices, and warns when more than 5 entries have no end date.

Python code is checked with [pre-commit](https://pre-commit.com) (`pre-commit run --all-files`).
