# [visawhen.com](https://visawhen.com)

Data on US visa wait times at the National Visa Center and at US embassies/consulates, and on USCIS processing of every form, by field office where USCIS publishes it.

## How it works

The site is a static [Next.js](https://nextjs.org) export: `next build` renders every page (one per consulate and visa class, one per USCIS form and field office) to `out/`, which GitHub Actions deploys to Cloudflare Workers on every push to `main` (`.github/workflows/deploy.yml`, which also describes how visawhen.com is served). Only `main` is deployed.

Pull requests run pre-commit, `bun lint`, `tsc`, the unit tests and a full build, with a read-only token and no secrets; one that touches `data/uscis`, `data/lib` or the packages also rebuilds `forms.json` from the reports cached on `main` (`forms.ts --offline`) and fails when it differs from the committed file.

The data lives in this repository and is refreshed by scheduled workflows that commit their results and trigger a deploy:

| Data                       | Source                                       | Scraper                                  | Output                                    |
| -------------------------- | -------------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| NVC wait times             | State's NVC timeframes page                  | `data/nvc/main.ts`                       | `data/nvc/data.json`                      |
| Consulate interview queues | State's IV Scheduling Status Tool            | `data/consulates/iv_schedule.ts --fetch` | `data/consulates/iv_schedule.json`        |
| Consulate visa issuances   | the State Department's monthly issuance PDFs | `data/consulates/visa_issuances.ts`      | `data/consulates/dump/` (sqlite-diffable) |
| USCIS form processing      | USCIS's quarterly reports                    | `data/uscis/forms.ts`                    | `data/uscis/forms.json`                   |
| USCIS monthly numbers      | USCIS's monthly Application Processing Data  | `data/uscis/monthly.ts`                  | `data/uscis/monthly.json`                 |
| Visa Bulletin cutoff dates | State's monthly Visa Bulletins               | `data/visa_bulletin/bulletin.ts`         | `data/visa_bulletin/data.json`            |

The NVC and interview-queue scrapers run in the same workflow (`nvc_update_schedule.yml`), daily and hourly on Mondays; the others run daily.

The home page leads to a timeline page per common route through the process (`/timeline/spouse-abroad` and six more). Each lists the route's steps with when each will most likely land, chained from where the visitor says their case is: the step's own page's estimate, counted from a date (`components/timeline.ts`; the data each page needs is assembled in `api/timeline.ts`). What the visitor enters stays in the page's memory and reaches no address, cookie or analytics.

## Running the site locally

You need [Bun](https://bun.com) (the version in `.bun-version`), which installs the packages, runs Next.js and the tests, and lints (`bun lint` is only in the canary for now: `bun upgrade --canary`). Node.js is not needed. `bun run dev` and `bun run build` first rebuild `data/consulates/consulates.sqlite` from its dump (`scripts/load-consulates-db.ts`, with Bun's built-in SQLite).

```sh
bun install         # install dependencies
bun run dev         # rebuilds data/consulates/consulates.sqlite, then serves the site on http://localhost:3000
bun run build       # the static export, into out/
bun lint            # lint
bun run typecheck   # tsc
bun run test        # the unit tests
```

The unit tests (`*.test.ts` next to the modules they test, run by `bun test`, written with `node:test` and `node:assert`) cover the logic the pages rest on: the planning ranges and the rules that suppress them (`components/estimate.ts`), the NVC review range (`components/nvcReview.ts`), which policy notices a page shows (`components/policy.ts`), the USCIS figures and the chart notes (`components/uscis.ts`), the Visa Bulletin arithmetic, the search ranking and the redirects check, and the scrapers' parsers (`data/**/*.test.ts`), including the CSV, XLSX and PDF readers in `data/lib/`. The NVC backtest (`bun data/nvc/backtest.mjs`) runs the same modules against NVC's published timeframes.

## Running the scrapers

The scrapers are TypeScript. They run with Bun from the repository root, after `bun install`, and share the helpers in `data/lib/`:

```sh
bun data/nvc/main.ts
bun data/uscis/forms.ts                          # add --offline to reparse the cached reports only
bun data/uscis/monthly.ts                        # or --from-file report.csv --url https://www.uscis.gov/...
bun data/consulates/visa_issuances.ts                   # writes dump/; --offline reads the downloaded PDFs only
bun data/consulates/iv_schedule.ts --fetch   # or --from-file page.html, for a page saved from a browser
bun data/visa_bulletin/bulletin.ts   # or --from-file page.html --month 2026-10
```

### Where the State Department data comes from

travel.state.gov sits behind Cloudflare, which answers scripts with a 403 challenge page. The State Department scrapers therefore try, in order:

1. the page on travel.state.gov;
2. the same path on adoption.state.gov, which serves the same pages and PDFs without Cloudflare in front of it. It is not advertised and could go away, which is why it is not the first choice;
3. the Wayback Machine: the NVC and interview-queue scrapers look for captures of the page on either host, the issuance script for captures of the travel.state.gov listing page only.

They identify themselves with the user agent `visawhen-bot (+https://github.com/underyx/visawhen)`. Every reading is keyed by the date on the page itself ("As of 21-Sep-26", "Last Updated: September 23, 2026"), and a date already in the data is never overwritten, so a stale copy cannot replace newer data. After a run that added data, the NVC and interview-queue scrapers ask the Wayback Machine to capture the pages (Save Page Now), so the last fallback has something to fall back to; only then, not after every fetch, since the NVC workflow runs about 30 times on a Monday and an unchanged page needs no new capture. uscis.gov blocks scripts too; `forms.ts` and `monthly.ts` fall back to the Wayback Machine. See the docstring at the top of each script for the details.

The interview queues come from State's [IV Scheduling Status Tool](https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/iv-wait-times.html), which only ever shows its latest monthly update, so every snapshot in `data/consulates/iv_schedule.json` is history nobody else keeps. The snapshots before September 2026 were recovered from Wayback Machine captures of the tool, with `--from-file`. `--fetch` adds a snapshot only when State's update is newer than the newest one there, and refuses (and fails) a page that lists far fewer posts than the newest snapshot, such as a truncated one, since the site reads only the newest snapshot; a page older than the newest snapshot or more than 45 days old may be a stale copy, so it then tries the next source too. `--from-file` adds any update it does not have yet, whatever it lists.

### USCIS monthly numbers

Every month since November 2022, USCIS publishes for Congress a short "Application Processing Data" report: for the I-130, I-360, I-485 (by category), I-751, I-765 and N-400, the applications received, approved, denied and pending, those pending over six months, and the average processing time of the month's decisions. It comes out about four weeks after the month, two months sooner than the quarterly reports. Where it has a row for what a form's page shows (all of those forms' categories except the I-130's, I-765's and N-400's single ones, which it does not split out), the cards at the top of the page show its newest month instead of the newest quarter, and a table under the quarterly chart lists its last six months, so that visitors see the newest numbers without having to know which report they come from. On a single category it does not split out (the page of the N-400 opens on its civilian one), the cards keep the category's newest quarter, and a line under them and the table give the whole form's months. Its counts land within a few percent of the quarterly reports' but are not the same. Its average processing time is an average over the month's decisions, not the median the estimates use, so the pages do not show it. `monthly.ts` adds each month once, keyed by the month the report names, from uscis.gov or else the Wayback Machine.

### Visa Bulletins

`bulletin.ts` keeps every monthly Visa Bulletin since October 2015, the first with both of today's charts: Final Action Dates and Dates for Filing. For each family and employment category and each chargeability area, `data.json` has the cutoff date, or `C` (current) or `U` (unavailable). The bulletins come from the same three sources as the other State Department data, in the same order. State publishes each bulletin once, around the middle of the month before, so a month already in `data.json` is never fetched again. A row, column or cell the script does not know fails the run instead of being skipped, so that a change in State's tables is noticed: add the new label to the patterns at the top of the script. The pages under `/visa-bulletin` show the newest bulletin and how far each category's Final Action Date moved in the last 12 months and 5 years.

### Consulate visa classes

State's monthly issuance reports give every row a visa class code. `visa_issuances.ts` keeps immigrant (IV) and nonimmigrant (NIV) classes apart, since some codes mean different things in the two reports (IV E2 is EB-2, NIV E2 a treaty investor), and maps the detailed immigrant codes State used until January 2021 (DV1, DV2 and DV3) onto the categories it has reported since (DV), so that each page's series runs across the change. Codes State adds later go the same way: the EB-5 set-aside codes (RR, RR1, NH and so on) are counted in EB-5, and the script warns when a code with and without a trailing digit (CQ and CQ1) would be counted apart. The descriptions of the classes the script names or merges, and of any whose description in the Google Sheet needs fixing, are in `data/consulates/visa_descriptions.csv`, which wins over the sheet; the others come from the sheet. When a class or post page goes away, a rule in `public/_redirects` sends it to its replacement. Cloudflare keeps 2,000 rules without a placeholder or splat and 100 with, but counts every rule after the first one with a placeholder or splat as one with, and skips what goes past the limits without failing the deploy; it also follows a matching rule even where a page exists. So every rule without a placeholder must come first, and `bun run build` runs `scripts/check-redirects.mjs`, which drops any rule that matches a page and fails the build on a rule without a placeholder after one with, or past either limit.

The consulate list shows and searches each post's country, from `POST_COUNTRIES` in `api/searchTerms.ts`, which is written by hand; the build fails on a post that has none, so add one when State reports a new post. The same file has the plain-language names and search words of the USCIS forms ("work permit" for the I-765).

### Discord notifications

When a data workflow commits new numbers, `data/notify.py` posts them to a Discord channel, pinging a role: NVC's timeframes (the `nvc-watch` role) and the N-400's monthly numbers (`n400-watch`). Each message is a card (an embed) in the site's violet, its title linking to the page, with a line per number; over the card comes one plain line that repeats the numbers and pings the role, since a phone's notification shows a message's text, not its card, and shows markdown as typed. An NVC message gives, for each of the three timeframes, the previous and the new number of days ("56 → 62 days"), with a red circle when the wait got 3 or more days longer, a yellow one when it got 1 or 2 days longer, a green one when it got 3 or more days shorter and a white one otherwise, or a note that NVC gave no new number for it. An N-400 message gives the newest month's processing time, pending applications and approvals against the month before, coloured by the relative change: red when 5% or more worse, yellow when worse by less, green when 5% or more better, white otherwise; the quarterly report posts nothing, since the monthly posts have covered its months by the time it comes out. A source posts only when its newest reading or month is newer than in the commit before, so each change is posted once, by the run that committed it. The webhook URL is the `DISCORD_WEBHOOK_URL` Actions secret (in Discord: the channel's settings, Integrations, Webhooks, Copy Webhook URL); without it the step only prints the messages. The roles are the `DISCORD_ROLES` Actions variable, a JSON object of role names to numeric role IDs, such as `{"nvc-watch": "1558910798469013635"}` (in Discord, with Developer Mode on under Settings, Advanced: Server Settings, Roles, the role's menu, Copy Role ID); without it nobody is pinged. Members give themselves these roles: the server's onboarding question (Discord: Server Settings, Onboarding) asks each new member which updates they want a ping for, and members already in the server answer it under Channels & Roles, above the channel list. The site says so in one small line under the figures of `/nvc` and `/uscis/n-400`, and in the footer (`components/DiscordUpdates.tsx`); the footer's line is the Discord link phones have, since the header's button is hidden below the `xs` breakpoint. To see what the messages would say, `python3 data/notify.py --before <commit> --dry-run` compares the data files with that commit's; without `--dry-run` and with the URL in `DISCORD_WEBHOOK_URL`, it posts them.

### Stale data alerts

A scraper that finds nothing new, or cannot reach its source, still finishes green. The daily `freshness.yml` workflow runs `data/freshness.py`, which compares each source's newest date with how often it publishes (NVC weekly, the interview-queue tool, the Visa Bulletin and USCIS's monthly report monthly, USCIS's other reports quarterly and State's issuance statistics with a lag of several months), and the policy notices' oldest re-check (below). For each source that is overdue it opens one issue labelled `stale-data`, keeps it up to date while the data stays stale and closes it when new data arrives. `python3 data/freshness.py` prints the same report locally. `--json out.json` also writes it as one row per source (newest data, the day it turns stale, "stale", "due soon" or "current", and the workflow that updates it); the weekly upkeep routine uses it to refresh a private data freshness report.

GitHub disables scheduled workflows in a public repository after 60 days without activity, and data commits can stop for longer than that. The same workflow keeps the scheduled workflows enabled through the Actions API instead of committing anything: every day it calls the enable endpoint for each one that is enabled or that GitHub disabled for inactivity, as keepalive-workflow's API mode does. A workflow disabled by hand (Actions, the workflow, "Disable workflow") is left alone and stays disabled until someone enables it again.

The policy notices (posts that paused or moved their visa services, visa suspensions by nationality, and other news about immigration rules) are written by hand in `data/policy.json`, each with its sources and the date someone last checked it against them (`lastChecked`). Re-check them about weekly: a page drops an entry that has not ended once that date is 29 days old (`UNCHECKED_DAYS` in `components/policy.ts`), so a notice nobody re-checks disappears rather than going stale; a week before, the build warns and the daily freshness check opens a `stale-data` issue. An entry that has ended needs no more re-checks. `end` is the day an entry ended or is due to end, the first day it no longer applies: from that day the page says "Ended" instead of "Ends", the interview card gives State's months again once State publishes an update dated on or after that day, and 60 days later the page drops the entry. `start` is the day it took effect: an entry announced ahead of time is not shown or applied before then. `"status": "reported"` marks an entry that has no State Department notice; publish one only when at least two independent reputable sources report it. `"overridesSchedule": true` keeps the interview card from presenting State's month as a queue at the entry's posts. `scope` names post slugs (`posts`), every consulate page (`allConsulatePages`), posts left out of that (`exceptPosts`, for instance where a worldwide pause is reported to have ended) or other pages by path (`pages`: `/nvc`, `/uscis/i-485`, a timeline page or a Visa Bulletin area page, the paths `POLICY_PAGES` in `components/policy.ts` lists); `"immigrantVisasOnly": true` in `scope` leaves an entry about immigrant visas only off the pages of the nonimmigrant visa classes that do not go through NVC (all but the K visas). On the consulate pages, the entries that name the post, and any that pauses every post, stay open above the interview card; every other entry is a chip in a "Recent news:" row under it, as on /nvc, and opens as a note (`"expanded": true` puts an entry's chip first in that row, after the ones that name the page). `label` is an entry's title in a few words for that chip ("Interview delays"). The build fails when an entry lacks its label, summary, dates or sources or names a page that shows no notices, and warns when more than 8 entries have no end date or a summary runs long.

Most visitors read English as a second language, so write every notice in plain English: short sentences, common words, no idioms, and any official term (public charge, documentarily complete, chargeable to India) explained where it first appears. Each entry has three texts:

- `title`: a few words naming what changed, such as "Visa services paused at this embassy". Page titles and the interview card quote it, so it must make sense on its own.
- `summary`: one or two short sentences, shown first: what changed, who it affects and, where there is one, what the reader can do. Leave out sources, court case names and long lists. A `"reported"` entry starts with "News reports say"; its badge already says there is no State Department notice. The build warns when a summary is longer than two sentences or 45 words.
- `body`: the details, behind a "Details" toggle in an open notice and under a rule in a note, with the sources: dates, who said what, the full lists of countries or categories and the official wording. A blank line (`\n\n`) starts a new paragraph.

Every other message on the site follows the same pattern: one or two plain sentences first. An open notice keeps the rest behind a "Details" toggle (`components/MoreDetails.tsx`). Our own reading of the numbers (a queue that has stalled, old data, USCIS deciding fewer cases) is a warning chip that opens its text as a note (`components/NoteChip.tsx`, `tone="warning"`), and special cases are plain chips in a "Special cases:" row; the conventions are in NoteChip's header comment.

The files are checked with [pre-commit](https://pre-commit.com) (ruff and mypy for Python, `bun fmt` for the rest): `git add -A && pre-commit run --all-files`, or `uvx pre-commit run --all-files` after the `git add`. pre-commit only sees the files git tracks, so a new file is not checked until it is staged.
