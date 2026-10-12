import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VisaBulletinData } from "../api/visaBulletin";
import {
  addMonthsToMonth,
  areaBySlug,
  bornInText,
  categoryBySlug,
  chartAreas,
  cutoffChange,
  cutoffDirection,
  formatBulletinMonth,
  formatCutoff,
  formatMonths,
  getMovement,
  getSeries,
  isDate,
  monthsBetweenDates,
  newestMonth,
  pagePath,
  type Series,
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
  it("say where a page's people were born", () => {
    const all = areaBySlug("other-countries");
    const india = areaBySlug("india");
    assert.ok(all !== undefined && india !== undefined);
    const areas = chartAreas({
      F4: { all: "C", china: "C", india: "C", mexico: "C", philippines: "C" },
    });
    assert.equal(bornInText(india, areas), "born in India");
    assert.equal(
      bornInText(all, areas),
      "born outside China, India, Mexico and the Philippines",
    );
    assert.equal(
      bornInText(all, chartAreas({ F1: { all: "C", mexico: "C" } })),
      "born outside Mexico",
    );
    assert.equal(
      bornInText(
        all,
        chartAreas({ F1: { all: "C", mexico: "C", philippines: "C" } }),
      ),
      "born outside Mexico and the Philippines",
    );
    // a chart that lists no other area
    assert.equal(
      bornInText(all, chartAreas({ F1: { all: "C" } })),
      "born in any country not listed separately",
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
      steady: false,
    });
    assert.equal(getMovement(series, 3), null);
    assert.equal(getMovement([], 1), null);
    // no months when either end is not a date
    assert.equal(
      getMovement(getSeries(data, "finalAction", "EB-2", "india"), 2)?.months,
      null,
    );
    // steady when every bulletin between gave the same cutoff
    assert.equal(
      getMovement(getSeries(data, "finalAction", "EB-2", "all"), 2)?.steady,
      true,
    );
    assert.equal(
      getMovement(
        [
          ["2025-10", "C"],
          ["2026-06", "2025-01-01"],
          ["2026-10", "C"],
        ],
        12,
      )?.steady,
      false,
    );
  });

  it("says how the newest cutoff compares with the one before", () => {
    const change = (series: Series) => cutoffChange(series);
    assert.deepEqual(change(getSeries(data, "finalAction", "F1", "all")), {
      text: "+4 months since Sep",
      color: "teal.9",
    });
    assert.deepEqual(
      change([
        ["2026-09", "2024-09-01"],
        ["2026-10", "2024-05-15"],
      ]),
      { text: "−4 months since Sep", color: "red.9" },
    );
    assert.deepEqual(
      change([
        ["2025-12", "2016-01-01"],
        ["2026-01", "2017-03-01"],
      ]),
      { text: "+1 year and 2 months since Dec", color: "teal.9" },
    );
    assert.deepEqual(change(getSeries(data, "finalAction", "F1", "mexico")), {
      text: "same as in Sep",
      color: "dimmed",
    });
    // a move too small for a whole month is given in days
    assert.deepEqual(
      change([
        ["2026-09", "2001-04-08"],
        ["2026-10", "2001-04-22"],
      ]),
      { text: "+14 days since Sep", color: "teal.9" },
    );
    assert.deepEqual(
      change([
        ["2026-09", "2001-04-08"],
        ["2026-10", "2001-04-07"],
      ]),
      { text: "−1 day since Sep", color: "red.9" },
    );
  });

  it("says what a cutoff was when either is current or unavailable", () => {
    // the bulletin before is two months back, so it is named with its year;
    // a date that became unavailable moved back
    assert.deepEqual(
      cutoffChange(getSeries(data, "finalAction", "EB-2", "india")),
      { text: "was Jan 1, 2013 in Aug 2026", color: "red.9" },
    );
    // a current category that gets a date again moved back
    assert.deepEqual(
      cutoffChange([
        ["2026-09", "C"],
        ["2026-10", "2025-01-01"],
      ]),
      { text: "was current in Sep", color: "red.9" },
    );
    // an unavailable one that gets a date moved forward
    assert.deepEqual(
      cutoffChange([
        ["2026-09", "U"],
        ["2026-10", "2013-11-01"],
      ]),
      { text: "was unavailable in Sep", color: "teal.9" },
    );
    assert.deepEqual(
      cutoffChange([
        ["2026-09", "U"],
        ["2026-10", "C"],
      ]),
      { text: "was unavailable in Sep", color: "teal.9" },
    );
    assert.deepEqual(
      cutoffChange([
        ["2026-09", "2025-01-01"],
        ["2026-10", "C"],
      ]),
      { text: "was Jan 1, 2025 in Sep", color: "teal.9" },
    );
    assert.deepEqual(
      cutoffChange(getSeries(data, "finalAction", "EB-2", "all")),
      {
        text: "same as in Aug 2026",
        color: "dimmed",
      },
    );
    assert.equal(cutoffChange([["2026-10", "C"]]), null);
    assert.equal(cutoffChange([]), null);
  });

  it("says which way the line moved, current at its front", () => {
    assert.equal(cutoffDirection("2024-01-01", "2024-03-01"), 1);
    assert.equal(cutoffDirection("2024-03-01", "2024-01-01"), -1);
    assert.equal(cutoffDirection("2024-01-01", "2024-01-01"), 0);
    assert.equal(cutoffDirection("C", "2025-01-01"), -1);
    assert.equal(cutoffDirection("U", "2013-11-01"), 1);
    assert.equal(cutoffDirection("2025-01-01", "C"), 1);
    assert.equal(cutoffDirection("2025-01-01", "U"), -1);
    assert.equal(cutoffDirection("C", "U"), -1);
    assert.equal(cutoffDirection("U", "C"), 1);
    assert.equal(cutoffDirection("C", "C"), 0);
    assert.equal(cutoffDirection("U", "U"), 0);
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
