# [visawhen.com](https://visawhen.com)

Data on US visa wait times at the National Visa Center and at US embassies/consulates, and on USCIS processing of every form, by field office where USCIS publishes it.

## How it works

The site is a static [Next.js](https://nextjs.org) export: `next build` renders every page (one per consulate and visa class, one per USCIS form and field office) to `out/`, which GitHub Actions deploys to Netlify and Cloudflare Workers on every push to `main` (`.github/workflows/deploy.yml`, which also describes how visawhen.com is served). Only `main` is deployed.

Pull requests run pre-commit, ESLint, `tsc` and a full build, with a read-only token and no secrets; one that touches `data/uscis` also rebuilds `forms.json` from the reports cached on `main` (`forms.py --offline`) and fails when it differs from the committed file.

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
cd data/consulates && uv run jupyter nbconvert --to script --stdout visa-issuances.ipynb | uv run python -   # writes all_months.pkl
cd data/consulates && uv run jupyter nbconvert --to script --stdout baselines.ipynb | uv run python -        # reads it, writes consulates.sqlite and dump/
cd data/consulates && uv run python iv_schedule.py --fetch   # or --from-file page.html, for a page saved from a browser
```

### Where the State Department data comes from

travel.state.gov sits behind Cloudflare, which answers scripts with a 403 challenge page. The State Department scrapers therefore try, in order:

1. the page on travel.state.gov;
2. the same path on adoption.state.gov, which serves the same pages and PDFs without Cloudflare in front of it. It is not advertised and could go away, which is why it is not the first choice;
3. the Wayback Machine: the NVC and interview-queue scrapers look for captures of the page on either host, the issuance notebook for captures of the travel.state.gov listing page only.

They identify themselves with the user agent `visawhen-bot (+https://github.com/underyx/visawhen)`. Every reading is keyed by the date on the page itself ("As of 21-Sep-26", "Last Updated: September 23, 2026"), and a date already in the data is never overwritten, so a stale copy cannot replace newer data. After a run that added data, the NVC and interview-queue scrapers ask the Wayback Machine to capture the pages (Save Page Now), so the last fallback has something to fall back to; only then, not after every fetch, since the NVC workflow runs about 30 times on a Monday and an unchanged page needs no new capture. uscis.gov blocks scripts too; `forms.py` falls back to the Wayback Machine. See the docstring at the top of each script for the details.

The interview queues come from State's [IV Scheduling Status Tool](https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/iv-wait-times.html), which only ever shows its latest monthly update, so every snapshot in `data/consulates/iv_schedule.json` is history nobody else keeps. The snapshots before September 2026 were recovered from Wayback Machine captures of the tool, with `--from-file`. `--fetch` adds a snapshot only when State's update is newer than the newest one there, and refuses (and fails) a page that lists far fewer posts than the newest snapshot, such as a truncated one, since the site reads only the newest snapshot; a page older than the newest snapshot or more than 45 days old may be a stale copy, so it then tries the next source too. `--from-file` adds any update it does not have yet, whatever it lists.

### Consulate visa classes

State's monthly issuance reports give every row a visa class code. `baselines.ipynb` keeps immigrant (IV) and nonimmigrant (NIV) classes apart, since some codes mean different things in the two reports (IV E2 is EB-2, NIV E2 a treaty investor), and maps the detailed immigrant codes State used until January 2021 (DV1, DV2 and DV3) onto the categories it has reported since (DV), so that each page's series runs across the change. Codes State adds later go the same way: the EB-5 set-aside codes (RR, RR1, NH and so on) are counted in EB-5, and the notebook warns when a code with and without a trailing digit (CQ and CQ1) would be counted apart. The descriptions of the classes the notebook names or merges are in `data/consulates/visa_descriptions.csv`; the others come from a Google Sheet. When a class or post page goes away, a rule in `public/_redirects` sends it to its replacement. Cloudflare keeps 2,000 rules without a placeholder or splat and 100 with, but counts every rule after the first one with a placeholder or splat as one with, and skips what goes past the limits without failing the deploy; it also follows a matching rule even where a page exists. So every rule without a placeholder must come first, and `yarn build` runs `scripts/check-redirects.mjs`, which drops any rule that matches a page and fails the build on a rule without a placeholder after one with, or past either limit.

The consulate list shows and searches each post's country, from `POST_COUNTRIES` in `api/searchTerms.ts`, which is written by hand; the build fails on a post that has none, so add one when State reports a new post. The same file has the plain-language names and search words of the USCIS forms ("work permit" for the I-765).

### Stale data alerts

A scraper that finds nothing new, or cannot reach its source, still finishes green. The daily `freshness.yml` workflow runs `data/freshness.py`, which compares each source's newest date with how often it publishes (NVC weekly, the interview-queue tool monthly, USCIS quarterly and State's issuance statistics with a lag of several months). For each source that is overdue it opens one issue labelled `stale-data`, keeps it up to date while the data stays stale and closes it when new data arrives. `python3 data/freshness.py` prints the same report locally.

GitHub disables scheduled workflows in a public repository after 60 days without activity, and data commits can stop for longer than that. The same workflow keeps the scheduled workflows enabled through the Actions API instead of committing anything: every day it calls the enable endpoint for each one that is enabled or that GitHub disabled for inactivity, as keepalive-workflow's API mode does. A workflow disabled by hand (Actions, the workflow, "Disable workflow") is left alone and stays disabled until someone enables it again.

The policy notices on the consulate and NVC pages (posts that paused or moved their visa services, visa suspensions by nationality) are written by hand in `data/policy.json`, each with its sources and the date someone last checked it against them (`lastChecked`). Re-check them about weekly: a page says an entry may be out of date once that date is more than 30 days old. `end` is the day an entry ended or is due to end, the first day it no longer applies: from that day the page says "Ended" instead of "Ends", the interview card gives State's months again once State publishes an update dated on or after that day, and 60 days later the page drops the entry. `start` is the day it took effect: an entry announced ahead of time is not shown or applied before then. `"status": "reported"` marks an entry that has no State Department notice; publish one only when at least two independent reputable sources report it. `"overridesSchedule": true` keeps the interview card from presenting State's month as a queue at the entry's posts. `scope` names post slugs (`posts`), every consulate page (`allConsulatePages`), posts left out of that (`exceptPosts`, for instance where a worldwide pause is reported to have ended) or other pages by path (`pages`, currently only `/nvc`); `"immigrantVisasOnly": true` in `scope` leaves an entry about immigrant visas only off the pages of the nonimmigrant visa classes that do not go through NVC (all but the K visas). On the consulate pages, the entries about the post itself are shown in full and the rest collapsed, with their titles listed. The build fails when an entry lacks its dates or sources or names a page that shows no notices, and warns when more than 5 entries have no end date.

The files are checked with [pre-commit](https://pre-commit.com) (ruff and mypy for Python, Prettier for the rest): `git add -A && pre-commit run --all-files`, or `uvx pre-commit run --all-files` after the `git add`. pre-commit only sees the files git tracks, so a new file is not checked until it is staged.
