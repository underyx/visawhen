const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// `next build` (output: "export") writes the site straight to out/, so the
// sitemap has to be written there too instead of the default public/.
const OUT_DIR = "out";

function git(...args) {
  return execFileSync("git", args, {
    cwd: __dirname,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    // dates in UTC, whatever the time zone of the build or of the committer
    env: { ...process.env, TZ: "UTC" },
  }).trim();
}

/** The commits where a shallow clone's history stops */
function shallowCommits() {
  const file = path.resolve(
    __dirname,
    git("rev-parse", "--git-path", "shallow"),
  );
  return fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean)
    : [];
}

/** The day (UTC) the newest change to any of these paths reached the branch,
 * "2026-09-28": the commit on the branch itself, so for a pull request the
 * day it was merged. Undefined when the history cannot tell: without git, or
 * when that commit is where a shallow clone's history stops, which shows
 * every file as added. build.yml fetches the whole history for this. */
function changedOn(...paths) {
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
function latest(dates) {
  return dates.filter(Boolean).sort().at(-1);
}

let pageDates;

/** A page's lastmod is the day the data it shows last changed on the site,
 * not the build time: it changes when the data does, not on every build,
 * which would teach search engines to ignore it. Nor is it the date the data
 * is about: USCIS publishes a quarter's numbers months after it ends, and a
 * lastmod of the quarter's end would look older than the search engine's
 * last visit. Undefined for the home page, whose text does not change with
 * the data. */
function getPageDates() {
  if (pageDates === undefined) {
    const uscis = changedOn("data/uscis/forms.json");
    // Only the form pages of the forms in USCIS's monthly report show its
    // numbers (components/monthlyNumbers.ts).
    const monthly = JSON.parse(
      fs.readFileSync(path.join(__dirname, "data/uscis/monthly.json"), "utf8"),
    );
    const monthlyForms = new Set(
      Object.values(monthly.months).flatMap((report) =>
        Object.keys(report.forms),
      ),
    );
    const { forms } = JSON.parse(
      fs.readFileSync(path.join(__dirname, "data/uscis/forms.json"), "utf8"),
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
    pageDates = {
      sections: {
        ...sections,
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
  return pageDates;
}

/** Whether the exported page asks search engines not to index it, as the
 * consulate pages of a visa class the post has not issued in two years do */
function isNoindex(loc) {
  const file = path.join(
    __dirname,
    OUT_DIR,
    loc === "/" ? "index.html" : `${loc}.html`,
  );
  const html = fs.readFileSync(file, "utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  return /<meta name="robots" content="[^"]*noindex/.test(head);
}

/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.SITE_URL || "https://visawhen.com",
  generateRobotsTxt: true,
  changefreq: "weekly",
  outDir: OUT_DIR,
  // No build time as every page's lastmod; see getPageDates.
  autoLastmod: false,
  transform: async (config, loc) => {
    // a page search engines should not index has no place in the sitemap
    if (isNoindex(loc)) return null;
    const { sections, pages } = getPageDates();
    const section = Object.keys(sections).find(
      (prefix) => loc === prefix || loc.startsWith(`${prefix}/`),
    );
    return {
      loc,
      changefreq: config.changefreq,
      priority: config.priority,
      lastmod:
        pages[loc] ?? (section === undefined ? undefined : sections[section]),
      alternateRefs: config.alternateRefs ?? [],
    };
  },
};
