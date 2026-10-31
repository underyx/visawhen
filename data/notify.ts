// Post new numbers to a Discord channel: NVC's timeframes, and the N-400's
// monthly numbers.
//
//     bun data/notify.ts                         # compare the data files with the commit before HEAD, post what is new
//     bun data/notify.ts --before <rev or dir>   # compare with another commit, or with a copy of data/
//     bun data/notify.ts --dry-run               # print the messages and post nothing
//     bun data/notify.ts --source nvc            # one source only: nvc or n400
//
// The data workflows run this right after they commit what their scraper
// found, so the commit before HEAD holds the data as it was before the run.
// Each source posts one message when its newest reading or month is newer
// than before, and nothing otherwise (the commit changed other data, or a
// fallback only filled in older readings), so a change is posted once, by the
// run that committed it:
//
// * nvc (data/nvc/data.json, Monday afternoons): for each timeframe, the
//   previous and the new number of days, with a circle for what the change
//   means: red when the wait got 3 or more days longer, yellow when it got 1
//   or 2 days longer, green when it got 3 or more days shorter and white
//   otherwise. A timeframe NVC gave no new number for says so.
// * n400 (data/uscis/monthly.json, about four weeks after each month):
//   USCIS's average processing time, pending applications and approvals for
//   the month, against the month before, coloured by the relative change:
//   red when 5% or more worse (a longer time, more pending, fewer
//   approvals), yellow when worse by less, green when 5% or more better,
//   white otherwise. USCIS's quarterly report (data/uscis/forms.json) posts
//   nothing: by the time it comes out, the monthly posts have covered its
//   months.
//
// Each message is a card (a Discord embed): the title, linking to the page
// on visawhen.com, with a line per number, in the site's violet. Over the
// card comes one plain line that repeats the numbers and pings the role: a
// phone's notification shows a message's text, not its card, and shows
// markdown as typed, so the line has none. (Discord's newer layout,
// Components V2, would suit the card better but its messages show nothing in
// notifications, an open Discord issue as of October 2026.) The webhook URL
// comes from the DISCORD_WEBHOOK_URL environment variable, a GitHub Actions
// secret of the same name (Discord: the channel's settings, Integrations,
// Webhooks, Copy Webhook URL). Without it, the messages are only printed and
// the run ends green, so that forks and runs before the secret is set do not
// fail. A post that Discord refuses fails the run: the data is committed by
// then, so the site is still built and deployed, and the red run says the
// webhook needs attention. The URL is never printed.
//
// The roles come from DISCORD_ROLES, a GitHub Actions variable holding a
// JSON object of role names to numeric role IDs, such as {"nvc-watch":
// "1558…", "n400-watch": "1558…"} (Discord: Settings, Advanced, Developer
// Mode; then Server Settings, Roles, the role's menu, Copy Role ID). A
// webhook cannot name a role, only mention it by ID. Without the variable or
// the entry, nobody is pinged, with a warning.
//
// Only Bun's built-in modules are used, so the workflows need no install.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const DATA = import.meta.dir;
const REPO = join(DATA, "..");
const WEBHOOK_ENV = "DISCORD_WEBHOOK_URL";
const ROLES_ENV = "DISCORD_ROLES";
const SITE = "https://visawhen.com";
const TIMEOUT_MS = 30_000;
// Discord's rate limit answers with 429 and the seconds to wait; one retry
// is plenty for a few messages a month.
const MAX_RETRY_AFTER = 30;

// Between the old and the new number
const ARROW = "→";
// What a change means for the wait: much worse, worse, much better, and
// anything else (the same, or a little better)
const MUCH_WORSE = "\u{1F534}";
const WORSE = "\u{1F7E1}";
const MUCH_BETTER = "\u{1F7E2}";
const SAME = "⚪";
// NVC: a change of this many days is much worse or much better
const NVC_MUCH_DAYS = 3;
// N-400: a change of this share of the number before is much worse or much
// better
const N400_MUCH_SHARE = 0.05;
// The card's colour: the site's stamp violet (pages/_app.tsx)
const COLOR = 0x6c47aa;

export interface Message {
  // "New NVC numbers", "New N-400 numbers for August 2026"
  title: string;
  // ["Document review", "🔴 56 → 62 days"]
  lines: [string, string][];
}

type NvcData = Record<string, Record<string, number> | undefined>;
interface MonthRow {
  averageMonths?: number | null;
  pending?: number | null;
  approved?: number | null;
}
interface MonthlyData {
  months?: Record<string, { forms?: Record<string, Record<string, MonthRow>> }>;
}

interface Source {
  name: string;
  // The data file, relative to data/
  path: string;
  // The DISCORD_ROLES entry to ping
  role: string;
  // Where the title links
  page: string;
  // The message for the new data, or null when it holds nothing newer
  // (a method, so that each source can take its own file's type)
  build(before: never, after: never): Message | null;
}

// --- formatting ---------------------------------------------------------------

const formatCount = (value: number) =>
  Math.trunc(value).toLocaleString("en-US");
const formatMonths = (value: number) => value.toFixed(1).replace(/\.0$/, "");

/** "2026-08" as "August 2026". */
export function formatMonth(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The circle for a change, measured as how much worse it made things. */
export function circle(worseBy: number, much: number): string {
  if (worseBy >= much) return MUCH_WORSE;
  if (worseBy > 0) return WORSE;
  if (worseBy <= -much) return MUCH_BETTER;
  return SAME;
}

/** "🔴 778,489 → 813,453": a line for an N-400 number against the period
 * before, coloured by the relative change. */
export function compare(
  old: number | null | undefined,
  value: number | null | undefined,
  render: (value: number) => string,
  unit = "",
  worseWhenUp = true,
): string {
  if (value === null || value === undefined) return `${SAME} no number`;
  if (old === null || old === undefined || old === 0)
    return `${SAME} ${render(value)}${unit}`;
  const change = (value - old) / old;
  const worseBy = worseWhenUp ? change : -change;
  return `${circle(worseBy, N400_MUCH_SHARE)} ${render(old)} ${ARROW} ${render(value)}${unit}`;
}

// --- NVC ----------------------------------------------------------------------

// In the order the site shows them: the series' key in data.json and its name
const NVC_TIMEFRAMES: [string, string][] = [
  ["review", "Document review"],
  ["creation", "Case creation"],
  ["inquiry", "Inquiry response"],
];

type Reading = [asOf: string, days: number];

/** A series' newest [as-of date, days], or null for an empty series. */
function newestReading(series: Record<string, number>): Reading | null {
  const asOf = Object.keys(series).sort().at(-1);
  return asOf === undefined ? null : [asOf, series[asOf]];
}

/** "🔴 56 → 62 days", or what there is when a reading is missing. */
function nvcLine(reading: Reading | null, old: Reading | null): string {
  if (reading === null)
    return old === null
      ? `${SAME} no update`
      : `${SAME} ${old[1]} days (no update)`;
  const days = reading[1];
  const unit = days === 1 ? "day" : "days";
  if (old === null) return `${SAME} ${days} ${unit}`;
  return `${circle(days - old[1], NVC_MUCH_DAYS)} ${old[1]} ${ARROW} ${days} ${unit}`;
}

/** The newest reading of each timeframe against the newest before the run;
 * null when no timeframe has a newer one. */
export function nvcMessage(before: NvcData, after: NvcData): Message | null {
  let changed = false;
  const lines: [string, string][] = [];
  for (const [key, label] of NVC_TIMEFRAMES) {
    const reading = newestReading(after[key] ?? {});
    const old = newestReading(before[key] ?? {});
    if (reading !== null && (old === null || reading[0] > old[0])) {
      changed = true;
      lines.push([label, nvcLine(reading, old)]);
    } else {
      // nothing new: the newest reading stands
      lines.push([label, nvcLine(null, reading)]);
    }
  }
  return changed ? { title: "New NVC numbers", lines } : null;
}

// --- N-400 --------------------------------------------------------------------

const N400 = "N-400";

/** The months with an N-400 row, oldest first. */
function n400Months(data: MonthlyData): string[] {
  const months = data.months ?? {};
  return Object.keys(months)
    .filter((month) => N400 in (months[month].forms ?? {}))
    .sort();
}

/** The month's N-400 row: USCIS's monthly report has one for the whole form. */
function n400MonthRow(data: MonthlyData, month: string): MonthRow {
  const rows = data.months![month].forms![N400];
  return rows.all || Object.values(rows)[0];
}

/** The newest month's numbers against the month before it; null when the
 * newest month is not new. */
export function n400Message(
  before: MonthlyData,
  after: MonthlyData,
): Message | null {
  const months = n400Months(after);
  const oldMonths = n400Months(before);
  if (
    months.length === 0 ||
    (oldMonths.length > 0 && months.at(-1)! <= oldMonths.at(-1)!)
  )
    return null;
  const row = n400MonthRow(after, months.at(-1)!);
  const old =
    months.length > 1 ? n400MonthRow(after, months.at(-2)!) : ({} as MonthRow);
  return {
    title: `New ${N400} numbers for ${formatMonth(months.at(-1)!)}`,
    lines: [
      [
        "Processing time",
        compare(old.averageMonths, row.averageMonths, formatMonths, " months"),
      ],
      ["Pending applications", compare(old.pending, row.pending, formatCount)],
      ["Approved", compare(old.approved, row.approved, formatCount, "", false)],
    ],
  };
}

const SOURCES: Source[] = [
  {
    name: "nvc",
    path: "nvc/data.json",
    role: "nvc-watch",
    page: `${SITE}/nvc`,
    build: nvcMessage,
  },
  {
    name: "n400",
    path: "uscis/monthly.json",
    role: "n400-watch",
    page: `${SITE}/uscis/n-400`,
    build: n400Message,
  },
];

// --- loading, rendering and posting -------------------------------------------

/** A data file as it was: from a copy of data/, or at a git revision. */
function loadBefore(before: string, path: string): unknown {
  if (existsSync(before) && statSync(before).isDirectory()) {
    return JSON.parse(readFileSync(join(before, path), "utf8"));
  }
  const result = Bun.spawnSync(["git", "show", `${before}:data/${path}`], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    console.error(
      `ERROR: git show ${before}:data/${path} failed: ${result.stderr.toString().trim()}`,
    );
    process.exit(1);
  }
  return JSON.parse(result.stdout.toString());
}

const loadAfter = (path: string): unknown =>
  JSON.parse(readFileSync(join(DATA, path), "utf8"));

/** The DISCORD_ROLES object, role names to IDs; empty, with a warning, when
 * it is unset or unusable. */
export function roles(rolesJson: string): Map<string, string> {
  if (!rolesJson.trim()) {
    console.log(`::warning::${ROLES_ENV} is not set, so no role is pinged`);
    return new Map();
  }
  let parsed: unknown;
  try {
    // an ID written as a bare number is longer than a double holds exactly
    parsed = JSON.parse(
      rolesJson.replace(/(:\s*)(\d{16,})(?=\s*[,}])/g, '$1"$2"'),
    );
  } catch {
    console.log(
      `::warning::${ROLES_ENV} is not valid JSON, so no role is pinged`,
    );
    return new Map();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.log(
      `::warning::${ROLES_ENV} is not a JSON object, so no role is pinged`,
    );
    return new Map();
  }
  return new Map(
    Object.entries(parsed).map(([name, id]) => [name, String(id)]),
  );
}

/** The ID of a role, or null (with a warning) when the map lacks it. */
function roleToPing(known: Map<string, string>, name: string): string | null {
  const roleId = known.get(name);
  if (roleId === undefined || !/^\d+$/.test(roleId)) {
    if (known.size > 0) {
      console.log(
        `::warning::${ROLES_ENV} has no "${name}" entry with a role ID (a number), so no role is pinged`,
      );
    }
    return null;
  }
  return roleId;
}

/** The message's text, shown over the card and as the notification on a
 * phone: one line with every number, no markdown (a notification shows it as
 * typed), the role mention last. */
export function plainLine(message: Message, roleId: string | null): string {
  const numbers = message.lines
    .map(([label, line]) => `${label} ${line}`)
    .join(", ");
  return `${message.title}: ${numbers}${roleId === null ? "" : ` <@&${roleId}>`}`;
}

/** What is POSTed to the webhook: the plain line, and the card, its title
 * linking to the page, then a field per number. The fields are not inline:
 * three columns do not fit a phone. */
export function payload(message: Message, page: string, roleId: string | null) {
  return {
    content: plainLine(message, roleId),
    embeds: [
      {
        title: message.title,
        url: page,
        color: COLOR,
        fields: message.lines.map(([name, value]) => ({
          name,
          value,
          inline: false,
        })),
      },
    ],
    // Only that role can be pinged, whatever else the text says
    allowed_mentions: { parse: [], roles: roleId === null ? [] : [roleId] },
  };
}

/** The payload as text, for the log. */
function describe(body: ReturnType<typeof payload>): string {
  const lines = [body.content];
  for (const embed of body.embeds) {
    lines.push(`[${embed.title}](${embed.url})`);
    lines.push(
      ...embed.fields.map((field) => `  ${field.name}: ${field.value}`),
    );
  }
  return lines.join("\n");
}

/** The seconds Discord's rate limit answer asks to wait, 1 when it says none. */
function retryAfterSeconds(answer: string): number {
  try {
    return (
      Number(
        (JSON.parse(answer) as { retry_after?: unknown }).retry_after ?? 1,
      ) || 1
    );
  } catch {
    return 1;
  }
}

/** POST the message to the webhook; whether Discord accepted it. Prints what
 * went wrong without the URL, which is a secret. */
async function post(
  webhookUrl: string,
  body: ReturnType<typeof payload>,
): Promise<boolean> {
  let status = 0;
  let answer = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // wait=true makes Discord answer 200 with the message instead of 204
      // on success, so that a refused message is told apart
      const response = await fetch(`${webhookUrl}?wait=true`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "visawhen-bot (+https://github.com/underyx/visawhen)",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = response.status;
      answer = await response.text();
    } catch (error) {
      console.error(
        `The request to Discord failed: ${error instanceof Error ? error.name : "error"}`,
      );
      return false;
    }
    if (status === 429 && attempt === 0) {
      const retryAfter = Math.min(
        Math.max(retryAfterSeconds(answer), 1),
        MAX_RETRY_AFTER,
      );
      console.log(
        `Discord asked to wait ${retryAfter.toFixed(0)}s (rate limit); retrying once`,
      );
      await Bun.sleep(retryAfter * 1000);
      continue;
    }
    break;
  }
  if (status !== 200) {
    console.error(`Discord answered HTTP ${status}: ${answer.slice(0, 500)}`);
    return false;
  }
  console.log("Posted to Discord");
  return true;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      before: { type: "string", default: "HEAD~1" },
      source: { type: "string", multiple: true },
      "dry-run": { type: "boolean" },
    },
  });
  const names = SOURCES.map((source) => source.name);
  for (const name of values.source ?? []) {
    if (!names.includes(name))
      throw new Error(`--source takes ${names.join(" or ")}, not ${name}`);
  }

  const knownRoles = roles(process.env[ROLES_ENV] ?? "");
  const webhookUrl = process.env[WEBHOOK_ENV] ?? "";
  let failed = false;
  let posted = 0;
  for (const source of SOURCES) {
    if (values.source && !values.source.includes(source.name)) continue;
    const message = source.build(
      loadBefore(values.before, source.path) as never,
      loadAfter(source.path) as never,
    );
    if (message === null) {
      console.log(`${source.name}: nothing newer than before`);
      continue;
    }
    const body = payload(
      message,
      source.page,
      roleToPing(knownRoles, source.role),
    );
    console.log(`${source.name}:\n${describe(body)}\n`);
    if (values["dry-run"]) continue;
    if (!webhookUrl) {
      console.log(
        `::notice::${WEBHOOK_ENV} is not set, so the message above was not posted to Discord`,
      );
      continue;
    }
    if (await post(webhookUrl, body)) posted++;
    else failed = true;
  }
  if (posted) console.log(`Posted ${posted} message${posted !== 1 ? "s" : ""}`);
  return failed ? 1 : 0;
}

if (import.meta.main) process.exit(await main());
