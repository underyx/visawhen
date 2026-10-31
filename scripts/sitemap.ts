// Writes out/sitemap.xml (an index), out/sitemap-<n>.xml and out/robots.txt
// after `next build` has exported the site to out/ (`bun run build`). Every
// exported page is listed, except 404.html and the pages that ask search
// engines not to index them; each with the day its data last changed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dir, "..");
const OUT_DIR = path.join(ROOT, "out");
const SITE_URL = "https://visawhen.com";
// URLs per sitemap file: search engines take up to 50,000, but the files have
// held 5,000 each since next-sitemap wrote them, and Search Console knows them.
const SITEMAP_SIZE = 5000;

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    // dates in UTC, whatever the time zone of the build or of the committer
    env: { ...process.env, TZ: "UTC" },
  }).trim();
}

/** The commits where a shallow clone's history stops */
function shallowCommits(): string[] {
  const file = path.resolve(ROOT, git("rev-parse", "--git-path", "shallow"));
  return fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean)
    : [];
}

/** The day (UTC) the newest change to any of these paths reached the branch,
 * "2026-09-28": the commit on the branch itself, so for a pull request the
 * day it was merged. Undefined when the history cannot tell: without git, or
 * when that commit is where a shallow clone's history stops, which shows
 * every file as added. build.yml fetches the whole history for this. */
function changedOn(...paths: string[]): string | undefined {
  try {
    const [commit, day] = git(
      "log",
      "-1",
      "--first-parent",
      "--date=format-local:%Y-%m-%d",
      "--format=%H %cd",
      "--",
      ...paths,
    ).split(" ");
    if (!commit || shallowCommits().includes(commit)) return undefined;
    return day;
  } catch {
    return undefined;
  }
}

/** The latest of some ISO dates, "2026-09-23" */
function latest(dates: (string | undefined)[]): string | undefined {
  return dates
    .filter((date): date is string => date !== undefined)
    .sort()
    .at(-1);
}

/** A page's lastmod is the day the data it shows last changed on the site,
 * not the build time: it changes when the data does, not on every build,
 * which would teach search engines to ignore it. Nor is it the date the data
 * is about: USCIS publishes a quarter's numbers months after it ends, and a
 * lastmod of the quarter's end would look older than the search engine's
 * last visit. The home page and the timeline pages change with every
 * source they show a number from. */
function getPageDates(): {
  sections: Record<string, string | undefined>;
  pages: Record<string, string | undefined>;
} {
  const uscis = changedOn("data/uscis/forms.json");
  // Only the form pages of the forms in USCIS's monthly report show its
  // numbers (components/monthlyNumbers.ts).
  const monthly: { months: Record<string, { forms: object }> } = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/uscis/monthly.json"), "utf8"),
  );
  const monthlyForms = new Set(
    Object.values(monthly.months).flatMap((report) =>
      Object.keys(report.forms),
    ),
  );
  const { forms }: { forms: { form: string; slug: string }[] } = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/uscis/forms.json"), "utf8"),
  );
  const uscisMonthly = latest([uscis, changedOn("data/uscis/monthly.json")]);
  const sections = {
    "/nvc": changedOn("data/nvc/data.json"),
    "/uscis": uscis,
    // the interview-scheduling tool and the monthly issuances
    "/consulates": changedOn(
      "data/consulates/iv_schedule.json",
      "data/consulates/dump",
    ),
    "/visa-bulletin": changedOn("data/visa_bulletin/data.json"),
  };
  return {
    sections: {
      ...sections,
      // the steps' ranges: USCIS, NVC, the interview queues and the Visa
      // Bulletin
      "/timeline": latest([
        uscis,
        sections["/nvc"],
        changedOn("data/consulates/iv_schedule.json"),
        sections["/visa-bulletin"],
      ]),
      // its line on each path: the USCIS ranges and NVC's readings
      "/": latest([uscis, sections["/nvc"]]),
      // it lists the newest date of every source, and of the notices
      "/about": latest([
        ...Object.values(sections),
        uscisMonthly,
        changedOn("data/policy.json"),
      ]),
    },
    pages: Object.fromEntries(
      forms
        .filter(({ form }) => monthlyForms.has(form))
        .map(({ slug }) => [`/uscis/${slug}`, uscisMonthly]),
    ),
  };
}

/** Whether the exported page asks search engines not to index it, as the
 * consulate pages of a visa class the post has not issued in two years do */
function isNoindex(file: string): boolean {
  const html = fs.readFileSync(file, "utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  return /<meta name="robots" content="[^"]*noindex/.test(head);
}

/** The exported pages' paths, "/" and "/consulates/london" */
function exportedPages(): { loc: string; file: string }[] {
  return fs
    .readdirSync(OUT_DIR, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".html") && file !== "404.html")
    .map((file) => ({
      loc: file === "index.html" ? "/" : `/${file.slice(0, -".html".length)}`,
      file: path.join(OUT_DIR, file),
    }))
    .sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));
}

const { sections, pages } = getPageDates();
const urls = exportedPages()
  // a page search engines should not index has no place in the sitemap
  .filter(({ file }) => !isNoindex(file))
  .map(({ loc }) => {
    const section = Object.keys(sections).find(
      (prefix) =>
        loc === prefix || (prefix !== "/" && loc.startsWith(`${prefix}/`)),
    );
    const lastmod =
      pages[loc] ?? (section === undefined ? undefined : sections[section]);
    const url = loc === "/" ? SITE_URL : `${SITE_URL}${loc}`;
    return (
      `<url><loc>${url}</loc>` +
      (lastmod === undefined ? "" : `<lastmod>${lastmod}</lastmod>`) +
      "<changefreq>weekly</changefreq><priority>0.7</priority></url>"
    );
  });

const XML = '<?xml version="1.0" encoding="UTF-8"?>';
const files: string[] = [];
for (let start = 0; start < urls.length; start += SITEMAP_SIZE) {
  const name = `sitemap-${files.length}.xml`;
  fs.writeFileSync(
    path.join(OUT_DIR, name),
    [
      XML,
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.slice(start, start + SITEMAP_SIZE),
      "</urlset>",
      "",
    ].join("\n"),
  );
  files.push(name);
}
fs.writeFileSync(
  path.join(OUT_DIR, "sitemap.xml"),
  [
    XML,
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...files.map((name) => `<sitemap><loc>${SITE_URL}/${name}</loc></sitemap>`),
    "</sitemapindex>",
    "",
  ].join("\n"),
);
fs.writeFileSync(
  path.join(OUT_DIR, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
);
console.log(`sitemap: ${urls.length} pages in ${files.length} files`);
