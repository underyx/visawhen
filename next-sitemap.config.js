const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.join(__dirname, "data");

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
}

/** The latest of some ISO dates, "2026-09-23" */
function latest(dates) {
  return dates.filter(Boolean).sort().at(-1);
}

/** The newest month of visa issuances, "2026-02-01", from the database that
 * `yarn build` loads before this runs */
function newestIssuanceMonth() {
  const sqlite3 = require("sqlite3");
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(
      path.join(dataDir, "consulates", "consulates.sqlite"),
      sqlite3.OPEN_READONLY,
    );
    db.get('SELECT MAX("Month") AS month FROM backlogs', (error, row) => {
      db.close();
      if (error) reject(error);
      else resolve(row.month.slice(0, 10));
    });
  });
}

let sectionDates;

/** The date of the newest data each section of the site shows. A page's
 * lastmod is its section's: it changes when the section's data does, not on
 * every build, which would teach search engines to ignore it. */
async function getSectionDates() {
  if (sectionDates === undefined) {
    const nvc = readJson("nvc/data.json");
    const uscis = readJson("uscis/forms.json");
    const newestQuarter = latest(
      uscis.forms.flatMap((form) => Object.keys(form.quarters)),
    );
    const ivSchedule = readJson("consulates/iv_schedule.json");
    const nvcDate = latest(Object.values(nvc).flatMap(Object.keys));
    // the end of the newest quarter with USCIS data
    const uscisDate = uscis.periods.find(
      (period) => period.quarter === newestQuarter,
    )?.end;
    // the consulate pages show both the interview-scheduling tool and the
    // monthly issuances
    const consulatesDate = latest([
      ...Object.keys(ivSchedule.snapshots),
      await newestIssuanceMonth(),
    ]);
    sectionDates = {
      "/nvc": nvcDate,
      "/uscis": uscisDate,
      "/consulates": consulatesDate,
      // it lists the newest date of every source
      "/about": latest([nvcDate, uscisDate, consulatesDate]),
    };
  }
  return sectionDates;
}

/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.SITE_URL || "https://visawhen.com",
  generateRobotsTxt: true,
  changefreq: "weekly",
  // `next build` (output: "export") writes the site straight to out/, so the
  // sitemap has to be written there too instead of the default public/.
  outDir: "out",
  // No build time as every page's lastmod; see getSectionDates.
  autoLastmod: false,
  transform: async (config, loc) => {
    const dates = await getSectionDates();
    const section = Object.keys(dates).find(
      (prefix) => loc === prefix || loc.startsWith(`${prefix}/`),
    );
    return {
      loc,
      changefreq: config.changefreq,
      priority: config.priority,
      // none for the home page, whose text does not change with the data
      lastmod: section === undefined ? undefined : dates[section],
      alternateRefs: config.alternateRefs ?? [],
    };
  },
};
