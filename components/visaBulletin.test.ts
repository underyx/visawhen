import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VisaBulletinData } from "../api/visaBulletin";
import {
  addMonthsToMonth,
  areaBySlug,
  categoryBySlug,
  chartAreas,
  formatBulletinMonth,
  formatCutoff,
  formatMonths,
  getMovement,
  getSeries,
  isDate,
  monthsBetweenDates,
  newestMonth,
  pagePath,
} from "./visaBulletin";

const data: VisaBulletinData = {
  source: "https://example.org/",
  bulletins: {
    "2026-08": {
      url: "https://example.org/2026-08",
      finalAction: {
        F1: { all: "2016-01-01", mexico: "2005-03-15" },
        "EB-2": { all: "C", india: "2013-01-01" },
      },
      datesForFiling: { F1: { all: "2017-01-01", mexico: "2005-10-01" } },
    },
    "2026-10": {
      url: "https://example.org/2026-10",
      finalAction: {
        F1: { all: "2016-07-01", mexico: "2005-03-15" },
        "EB-2": { all: "C", india: "U" },
      },
      datesForFiling: { F1: { all: "2017-01-01", mexico: "2005-10-01" } },
    },
    "2026-09": {
      url: "https://example.org/2026-09",
      finalAction: { F1: { all: "2016-03-01", mexico: "2005-03-15" } },
      datesForFiling: { F1: { all: "2017-01-01", mexico: "2005-10-01" } },
    },
  },
};

describe("the categories and areas", () => {
  it("are found by their page path segments", () => {
    assert.equal(categoryBySlug("eb-3-other-workers")?.key, "EW");
    assert.equal(categoryBySlug("f9"), undefined);
    assert.equal(areaBySlug("other-countries")?.key, "all");
    const category = categoryBySlug("f2a");
    const area = areaBySlug("philippines");
    assert.ok(category !== undefined && area !== undefined);
    assert.equal(pagePath(category, area), "/visa-bulletin/f2a/philippines");
  });
  it("are listed in a chart in the site's order", () => {
    assert.deepEqual(
      chartAreas({ F1: { mexico: "C" }, F2A: { all: "C", india: "U" } }).map(
        ({ key }) => key,
      ),
      ["all", "india", "mexico"],
    );
  });
});

describe("the series of a category in an area", () => {
  it("runs oldest first and leaves out bulletins without it", () => {
    assert.equal(newestMonth(data), "2026-10");
    assert.deepEqual(getSeries(data, "finalAction", "F1", "all"), [
      ["2026-08", "2016-01-01"],
      ["2026-09", "2016-03-01"],
      ["2026-10", "2016-07-01"],
    ]);
    assert.deepEqual(getSeries(data, "finalAction", "EB-2", "india"), [
      ["2026-08", "2013-01-01"],
      ["2026-10", "U"],
    ]);
    assert.deepEqual(getSeries(data, "finalAction", "EB-5-rural", "all"), []);
  });

  it("says how far the cutoff moved over some months", () => {
    const series = getSeries(data, "finalAction", "F1", "all");
    assert.deepEqual(getMovement(series, 2), {
      from: ["2026-08", "2016-01-01"],
      to: ["2026-10", "2016-07-01"],
      months: 6,
    });
    assert.equal(getMovement(series, 3), null);
    assert.equal(getMovement([], 1), null);
    // no months when either end is not a date
    assert.equal(
      getMovement(getSeries(data, "finalAction", "EB-2", "india"), 2)?.months,
      null,
    );
  });
});

describe("month arithmetic", () => {
  it("adds months to a month, across years", () => {
    assert.equal(addMonthsToMonth("2026-10", -12), "2025-10");
    assert.equal(addMonthsToMonth("2026-10", 3), "2027-01");
    assert.equal(addMonthsToMonth("2026-01", -1), "2025-12");
  });
  it("counts whole months between dates", () => {
    assert.equal(monthsBetweenDates("2016-01-01", "2016-07-01"), 6);
    assert.equal(monthsBetweenDates("2016-07-01", "2016-01-01"), -6);
    assert.equal(monthsBetweenDates("2016-01-01", "2016-01-10"), 0);
  });
  it("tells a date from C and U", () => {
    assert.equal(isDate("2016-01-01"), true);
    assert.equal(isDate("C"), false);
    assert.equal(isDate("U"), false);
  });
});

describe("formatting", () => {
  it("writes months as years and months", () => {
    assert.equal(formatMonths(14), "1 year and 2 months");
    assert.equal(formatMonths(5), "5 months");
    assert.equal(formatMonths(1), "1 month");
    assert.equal(formatMonths(24), "2 years");
    assert.equal(formatMonths(-13), "1 year and 1 month");
  });
  it("names a bulletin's month and a cutoff", () => {
    assert.equal(formatBulletinMonth("2026-10"), "October 2026");
    assert.equal(formatCutoff("2007-08-22"), "Aug 22, 2007");
    assert.equal(formatCutoff("C"), "Current");
    assert.equal(formatCutoff("U"), "Unavailable");
  });
});
