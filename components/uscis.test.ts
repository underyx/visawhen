import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Form, UscisData, Variant } from "../api/uscis";
import { counts, periods, point } from "./testing";
import {
  ALL_CATEGORIES,
  approvalRatesComparable,
  approximately,
  backlogTrend,
  categoryCounts,
  categoryName,
  cleanData,
  flowCheck,
  focusCategory,
  formatApprovalRate,
  formatChange,
  formatCount,
  formatMonths,
  formatPercent,
  formatPointChange,
  formViews,
  highlight,
  lastMedianLabel,
  medianBreaks,
  officeCategoryCounts,
  officeCategoryPoints,
  officePointOptions,
  openingOfficeCategory,
  processingTimeSeries,
  quarterLabel,
  rarelyApproves,
  republishedMedianQuarters,
  stalled,
  sumCounts,
  toPoints,
  WITHHELD_ESTIMATE,
} from "./uscis";

function variant(key: string, fields: Partial<Variant> = {}): Variant {
  return {
    key,
    title: `Form (${key
      .replace(/\b[a-z]/g, (c) => c.toUpperCase())
      .replace(/-/g, " ")})`,
    received: 1000,
    approved: 600,
    denied: 100,
    pending: 2000,
    processingTime: 6,
    ...fields,
  };
}

function form(
  number: string,
  quarters: Record<string, Variant[]>,
  fields: Partial<Form> = {},
): Form {
  return {
    form: number,
    slug: number.toLowerCase(),
    title: `Form ${number}`,
    category: null,
    quarters: Object.fromEntries(
      Object.entries(quarters).map(([quarter, variants]) => [
        quarter,
        {
          received: variants.reduce(
            (sum, { received }) => sum + (received ?? 0),
            0,
          ),
          approved: variants.reduce(
            (sum, { approved }) => sum + (approved ?? 0),
            0,
          ),
          denied: variants.reduce((sum, { denied }) => sum + (denied ?? 0), 0),
          pending: variants.reduce(
            (sum, { pending }) => sum + (pending ?? 0),
            0,
          ),
          variants,
        },
      ]),
    ),
    sources: {},
    offices: [],
    officeTotals: {},
    officeSources: {},
    ...fields,
  };
}

const year = periods("2025-Q1", "2025-Q4");

describe("quarterLabel", () => {
  it("names a quarter by its months", () => {
    assert.equal(quarterLabel(year[2]), "Jul–Sep 2025");
    assert.equal(
      quarterLabel(periods("2026-Q1", "2026-Q1")[0]),
      "Jan–Mar 2026",
    );
  });
});

describe("toPoints", () => {
  it("works a quarter's figures out, with a gap for a quarter without data", () => {
    const points = toPoints(year, {
      "2025-Q1": counts({
        received: 100,
        approved: 60,
        denied: 20,
        pending: 300,
      }),
      "2025-Q3": counts({
        received: 100,
        approved: 0,
        denied: 0,
        pending: 300,
      }),
    });
    assert.deepEqual(
      points.map(({ quarter }) => quarter),
      ["2025-Q1", "2025-Q2", "2025-Q3"],
    );
    const [first, gap, last] = points;
    assert.equal(first.label, "Jan–Mar 2025");
    assert.equal(first.completions, 80);
    assert.equal(first.waitMonths, 300 / (80 / 3));
    assert.equal(first.approvalRate, 0.75);
    assert.equal(first.approvalRange, null);
    assert.equal(first.approximate, false);
    assert.equal(gap.pending, null);
    assert.equal(gap.completions, null);
    assert.equal(gap.waitMonths, null);
    assert.equal(gap.label, "Apr–Jun 2025");
    assert.equal(last.waitMonths, null);
    assert.equal(last.approvalRate, null);
    assert.deepEqual(toPoints(year, {}), []);
  });

  it("counts a withheld approval or denial count as a few, as a range", () => {
    const [withheld] = toPoints(year, {
      "2025-Q1": {
        ...counts({ received: 100, approved: null, denied: 20, pending: 300 }),
        withheld: ["approved"],
      },
    });
    assert.equal(withheld.completions, WITHHELD_ESTIMATE + 20);
    assert.equal(withheld.approximate, true);
    assert.deepEqual(withheld.approvalRange, [1 / 21, 9 / 29]);
    assert.equal(withheld.approvalRate, WITHHELD_ESTIMATE / 25);
    const [unbounded] = toPoints(
      year,
      {
        "2025-Q1": {
          ...counts({ approved: null, denied: 20, pending: 300 }),
          withheld: ["approved"],
        },
      },
      { boundedWithheld: false },
    );
    assert.equal(unbounded.approvalRange, null);
    assert.equal(unbounded.approvalRate, null);
    const [noApprovals] = toPoints(year, {
      "2025-Q1": {
        ...counts({ approved: 0, denied: null, pending: 300 }),
        withheld: ["denied"],
      },
    });
    assert.deepEqual(noApprovals.approvalRange, [0, 0]);
    const [unpublished] = toPoints(year, {
      "2025-Q1": counts({ approved: null, denied: 20, pending: 300 }),
    });
    assert.equal(unpublished.completions, null);
  });

  it("carries the medians and where the counts come from", () => {
    const [p] = toPoints(
      year,
      {
        "2025-Q1": {
          ...counts({ pending: 10 }),
          variants: [
            variant("a", { processingTime: 4.5 }),
            variant("b", { processingTime: null }),
          ],
        },
      },
      { fromOfficeReport: ["2025-Q1"], checkFlow: false },
    );
    assert.deepEqual(p.processingTimes, { a: 4.5 });
    assert.equal(p.fromOfficeReport, true);
    assert.equal(p.flow, "unknown");
  });
});

describe("flowCheck", () => {
  const series = (pendings: number[], received = 300000, completions = 51000) =>
    pendings.map((pending, index) =>
      point({
        quarter: `q${index}`,
        pending,
        received,
        approved: completions,
        denied: 0,
      }),
    );

  it("marks a count the quarter's filings and decisions do not account for", () => {
    const [first, consistent] = flowCheck(series([606000, 855000]));
    assert.equal(first.flow, "unknown");
    assert.equal(consistent.flow, "consistent");
    assert.equal(consistent.suspect, false);
    const [, nearly] = flowCheck(series([606000, 900000]));
    assert.equal(nearly.flow, "consistent");
    const [, off] = flowCheck(series([606000, 1324000]));
    assert.equal(off.flow, "inconsistent");
    assert.equal(off.suspect, true);
  });

  it("makes only the odd quarter out of a spike suspect", () => {
    const points = [
      point({ quarter: "q0", pending: 606000 }),
      point({
        quarter: "q1",
        pending: 1324000,
        received: 300000,
        approved: 51000,
      }),
      point({
        quarter: "q2",
        pending: 964000,
        received: 200000,
        approved: 91000,
      }),
    ];
    const [, spike, after] = flowCheck(points);
    assert.equal(spike.flow, "inconsistent");
    assert.equal(spike.suspect, true);
    assert.equal(after.flow, "inconsistent");
    assert.equal(after.suspect, false);
  });

  it("lets small piles be, and leaves a series that rarely reconciles unchecked", () => {
    const [, small] = flowCheck([
      point({ quarter: "q0", pending: 100 }),
      point({ quarter: "q1", pending: 150 }),
    ]);
    assert.equal(small.flow, "consistent");
    const off = flowCheck(
      series(Array.from({ length: 9 }, (_, index) => 100000 * (index + 1))),
    );
    assert.ok(off.every(({ flow, suspect }) => flow === "unknown" && !suspect));
  });

  it("does not check against a missing count", () => {
    const [, missing, next] = flowCheck([
      point({ quarter: "q0", pending: 100 }),
      point({ quarter: "q1", pending: null }),
      point({ quarter: "q2", pending: 100 }),
    ]);
    assert.equal(missing.flow, "unknown");
    assert.equal(next.flow, "unknown");
  });
});

describe("cleanData", () => {
  const data: UscisData = {
    periods: year,
    forms: [
      form("I-870", {
        "2025-Q1": [
          variant("all", { received: 50, pending: 0, processingTime: 2 }),
        ],
        "2025-Q2": [
          variant("all", { received: 0, pending: 0, processingTime: 2 }),
        ],
      }),
    ],
  };

  it("reads a pending count of 0 with filings as unknown", () => {
    const cleaned = cleanData(data);
    assert.equal(cleaned.forms[0].quarters["2025-Q1"].pending, null);
    assert.equal(
      cleaned.forms[0].quarters["2025-Q1"].variants[0].pending,
      null,
    );
    assert.equal(cleaned.forms[0].quarters["2025-Q2"].pending, 0);
    assert.equal(data.forms[0].quarters["2025-Q1"].pending, 0);
    assert.equal(cleanData(data), cleaned);
  });

  it("drops the medians of a quarter whose report repeated the quarter before's", () => {
    const cleaned = cleanData({
      ...data,
      republishedMedianQuarters: ["2025-Q2"],
    });
    assert.equal(
      cleaned.forms[0].quarters["2025-Q1"].variants[0].processingTime,
      2,
    );
    assert.equal(
      cleaned.forms[0].quarters["2025-Q2"].variants[0].processingTime,
      null,
    );
  });
});

describe("republishedMedianQuarters", () => {
  it("finds the quarters in the medians when forms.json does not list them", () => {
    const keys = Array.from({ length: 10 }, (_, index) => `c${index}`);
    const rows = (medians: (index: number) => number) =>
      keys.map((key, index) =>
        variant(key, { processingTime: medians(index) }),
      );
    const data: UscisData = {
      periods: year,
      forms: [
        form("I-765", {
          "2025-Q1": rows((index) => index + 1),
          "2025-Q2": rows((index) => index + 1),
          "2025-Q3": rows((index) => index + 2),
          "2025-Q4": rows((index) => (index < 4 ? index + 2 : index + 3)),
        }),
      ],
    };
    assert.deepEqual(republishedMedianQuarters(data), ["2025-Q2"]);
    assert.deepEqual(
      republishedMedianQuarters({ ...data, republishedMedianQuarters: [] }),
      [],
    );
    const few: UscisData = {
      ...data,
      forms: [
        form("I-765", {
          "2025-Q1": rows(() => 1).slice(0, 5),
          "2025-Q2": rows(() => 1).slice(0, 5),
        }),
      ],
    };
    assert.deepEqual(republishedMedianQuarters(few), []);
  });
});

describe("formatting", () => {
  it("formats months, counts and shares", () => {
    assert.equal(formatMonths(null), "n/a");
    assert.equal(formatMonths(9.96), "10.0 months");
    assert.equal(formatMonths(10.4), "10 months");
    assert.equal(formatMonths(239.6), "240 months");
    assert.equal(formatMonths(240), "240+ months");
    assert.equal(formatCount(1234), "1,234");
    assert.equal(formatCount(null), "n/a");
    assert.equal(formatPercent(0.756), "76%");
    assert.equal(formatPercent(null), "n/a");
    assert.equal(approximately("41 months", true), "~41 months");
    assert.equal(approximately("n/a", true), "n/a");
    assert.equal(approximately("41 months", false), "41 months");
  });

  it("shows an approval rate as a range when a count was withheld", () => {
    assert.equal(
      formatApprovalRate(point({ quarter: "q", approvalRange: [0.57, 0.92] })),
      "57-92%",
    );
    assert.equal(
      formatApprovalRate(point({ quarter: "q", approvalRange: [0.5, 0.504] })),
      "50%",
    );
    assert.equal(
      formatApprovalRate(point({ quarter: "q", approved: 78, denied: 22 })),
      "78%",
    );
    assert.equal(formatApprovalRate(point({ quarter: "q" })), "n/a");
  });

  it("formats a change between quarters", () => {
    assert.equal(formatChange(100, 112), "+12%");
    assert.equal(formatChange(100, 92), "−8%");
    assert.equal(formatChange(100, 100), "unchanged");
    assert.equal(formatChange(100, 100.4), "unchanged");
    assert.equal(formatChange(0, 5), null);
    assert.equal(formatChange(null, 5), null);
    assert.equal(formatChange(5, undefined), null);
    assert.equal(formatChange(50, 200, 100), null);
    assert.equal(formatChange(200, 50, 100), null);
    assert.equal(formatPointChange(0.84, 0.78), "−6 pts");
    assert.equal(formatPointChange(0.78, 0.84), "+6 pts");
    assert.equal(formatPointChange(0.801, 0.804), "unchanged");
    assert.equal(formatPointChange(null, 0.8), null);
  });
});

describe("stalled and comparable quarters", () => {
  const history = (last: number) =>
    [1000, 1000, 1000, 1000, last].map((approved, index) =>
      point({ quarter: `q${index}`, approved }),
    );

  it("sees decisions that nearly stopped against the four quarters before", () => {
    assert.equal(stalled(history(100), 4), true);
    assert.equal(stalled(history(300), 4), false);
    assert.equal(stalled(history(100), 3), false);
    assert.equal(
      stalled(
        [
          ...history(100).slice(0, 2),
          point({ quarter: "q2", completions: null }),
          ...history(100).slice(3),
        ],
        4,
      ),
      false,
    );
    assert.equal(stalled(history(100), 9), false);
  });

  it("compares approval rates only on exact counts of 100 or more", () => {
    const current = point({ quarter: "q", approved: 90, denied: 10 });
    assert.equal(
      approvalRatesComparable(
        point({ quarter: "p", approved: 80, denied: 20 }),
        current,
      ),
      true,
    );
    assert.equal(
      approvalRatesComparable(
        point({ quarter: "p", approved: 80, denied: 19 }),
        current,
      ),
      false,
    );
    assert.equal(
      approvalRatesComparable(
        point({ quarter: "p", approved: 80, denied: 20, approximate: true }),
        current,
      ),
      false,
    );
    assert.equal(
      approvalRatesComparable(
        point({ quarter: "p", approved: 80, denied: 20 }),
        current,
        true,
      ),
      false,
    );
    assert.equal(approvalRatesComparable(undefined, current), false);
  });

  it("calls the time to clear rising or easing beyond 10%", () => {
    assert.equal(backlogTrend(10, 11.5), "rising");
    assert.equal(backlogTrend(10, 10.5), "steady");
    assert.equal(backlogTrend(10, 8), "easing");
    assert.equal(backlogTrend(null, 5), null);
    assert.equal(backlogTrend(0, 5), null);
    assert.equal(backlogTrend(300, 250), null);
    assert.equal(backlogTrend(250, 100), "easing");
  });
});

describe("highlight", () => {
  const before = point({
    quarter: "Jan–Mar 2026",
    pending: 1000,
    received: 350,
    approved: 300,
    flow: "consistent",
  });
  const now = point({
    quarter: "Apr–Jun 2026",
    pending: 1120,
    received: 350,
    approved: 300,
    flow: "consistent",
  });

  it("says how the pile and the time to clear it changed", () => {
    assert.equal(
      highlight([before, now], "USCIS", "I-130 applications"),
      "The pile of pending I-130 applications at USCIS grew 12% to 1,120 in Apr–Jun 2026. At that quarter's pace of decisions, clearing it would take 11 months, up from 10 months.",
    );
    assert.equal(
      highlight(
        [before, { ...now, pending: 1000, waitMonths: 10 }],
        "USCIS",
        "I-130 applications",
      ),
      "The pile of pending I-130 applications at USCIS stayed at 1,000 in Apr–Jun 2026. At that quarter's pace of decisions, clearing it would take 10 months, the same as the quarter before.",
    );
    assert.equal(
      highlight([before, now], "USCIS", "I-130 applications", null, "month"),
      "The pile of pending I-130 applications at USCIS grew 12% to 1,120 in Apr–Jun 2026. At that month's pace of decisions, clearing it would take 11 months, up from 10 months.",
    );
  });

  it("says when USCIS moved cases, and when the change is unexplained", () => {
    assert.equal(
      highlight(
        [before, now],
        "the Baltimore office",
        "I-130 applications",
        "in",
      ),
      "The pile of pending I-130 applications at the Baltimore office grew 12% to 1,120 in Apr–Jun 2026 as USCIS moved or routed cases here from elsewhere. At that quarter's pace of decisions, clearing it, cases moved or routed in included, would take 11 months; the quarter before is not comparable.",
    );
    assert.equal(
      highlight(
        [before, { ...now, flow: "inconsistent" }],
        "USCIS",
        "I-130 applications",
      ),
      "The count of pending I-130 applications at USCIS went from 1,000 to 1,120 in Apr–Jun 2026 (+12%), but that quarter's filings minus its decisions come to +50, which doesn't account for the change, so we don't read it as USCIS catching up or falling behind. At that quarter's pace of decisions, clearing it would take 11 months.",
    );
  });

  it("gives the counts themselves for a small pile, and the first quarter alone", () => {
    assert.equal(
      highlight(
        [
          point({ quarter: "Q1", pending: 15, approved: 300 }),
          point({ quarter: "Q2", pending: 129, approved: 300 }),
        ],
        "Christiansted",
        "I-130 applications",
      ),
      "The pile of pending I-130 applications at Christiansted went from 15 to 129 in Q2. At that quarter's pace of decisions, clearing it would take 1.3 months, up from 0.1 months.",
    );
    assert.equal(
      highlight(
        [point({ quarter: "Q1", pending: 1000, approved: 300 })],
        "USCIS",
        "I-130 applications",
      ),
      "The pile of pending I-130 applications at USCIS stood at 1,000 in Q1. At that quarter's pace of decisions, clearing it would take 10 months.",
    );
    assert.equal(highlight([], "USCIS", "I-130 applications"), "");
  });

  it("falls back to the decisions when there is no pending count", () => {
    assert.equal(
      highlight(
        [
          point({
            quarter: "Q1",
            pending: null,
            approved: 300,
            approximate: true,
          }),
        ],
        "USCIS",
        "I-130 applications",
      ),
      "USCIS decided about 300 I-130 applications in Q1; it did not publish how many were pending.",
    );
    assert.equal(
      highlight(
        [point({ quarter: "Q1", pending: null, approved: 300 })],
        "the Boston office",
        "N-400 applications",
      ),
      "USCIS decided 300 N-400 applications at the Boston office in Q1; it did not publish how many were pending.",
    );
  });
});

describe("category names", () => {
  it("come from the row's title, or the pages' own names", () => {
    const i130 = { form: "I-130", title: "Petition for Alien Relative" };
    assert.equal(
      categoryName(
        { key: "immediate-relative", title: "I-130 (Immediate Relative)" },
        i130,
        2,
      ),
      "Immediate Relative",
    );
    assert.equal(
      categoryName({ key: "all", title: "I-130" }, i130, 2),
      "All relatives",
    );
    assert.equal(
      categoryName({ key: "all", title: "I-130" }, i130, 1),
      "I-130",
    );
    assert.equal(
      categoryName(
        { key: "all", title: "I-90" },
        { form: "I-90", title: "Application to Replace" },
        2,
      ),
      "All categories",
    );
    assert.equal(
      categoryName(
        {
          key: "advance-parole",
          title: "Form I-131, Application for Advance Parole",
        },
        { form: "I-131", title: "Form I-131" },
        5,
      ),
      "Advance Parole",
    );
    assert.equal(
      categoryName(
        { key: "other", title: "Form I-131, Application for Something Else" },
        { form: "I-131", title: "Form I-131" },
        5,
      ),
      "Application for Something Else",
    );
    assert.equal(
      categoryName(
        { key: "fiance", title: "Petition for Alien Fiancé(e)" },
        { form: "I-129F", title: "Petition for Alien Fiancé(e)" },
        2,
      ),
      "Petition for Alien Fiancé(e)",
    );
  });
});

describe("the median lines of a chart", () => {
  const i765 = form("I-765", {
    "2025-Q1": [variant("all", { processingTime: 3 })],
    "2025-Q2": [variant("all", { processingTime: 3 })],
    "2025-Q3": [
      variant("adjustment-of-status", { received: 100, processingTime: 6 }),
      variant("all-other", { received: 900, processingTime: 2 }),
      variant("tps", { received: 50, processingTime: null }),
    ],
    "2025-Q4": [
      variant("adjustment-of-status", { received: 100, processingTime: 6 }),
      variant("all-other", { received: 900, processingTime: 2 }),
      variant("tps", { received: 50, processingTime: null }),
    ],
  });
  const points = toPoints(year, i765.quarters);

  it("are the categories with a median, the current ones first, at most four", () => {
    assert.deepEqual(processingTimeSeries(points, i765), [
      { key: "all-other", label: "Other Categories" },
      { key: "adjustment-of-status", label: "Adjustment of Status" },
      { key: "all", label: "All categories" },
    ]);
    const one = form("I-90", {
      "2025-Q1": [variant("all", { processingTime: 3 })],
    });
    assert.deepEqual(processingTimeSeries(toPoints(year, one.quarters), one), [
      { key: "all", label: "" },
    ]);
    const many = form("I-131", {
      "2025-Q1": Array.from({ length: 6 }, (_, index) =>
        variant(`c${index}`, { received: index, processingTime: 1 }),
      ),
    });
    assert.deepEqual(
      processingTimeSeries(toPoints(year, many.quarters), many).map(
        ({ key }) => key,
      ),
      ["c5", "c4", "c3", "c2"],
    );
  });

  it("say where the last median was when USCIS stopped publishing one", () => {
    assert.equal(lastMedianLabel(points, ["all"]), "Apr–Jun 2025");
    assert.equal(lastMedianLabel(points, ["all-other"]), null);
    assert.equal(lastMedianLabel(points), null);
    assert.equal(lastMedianLabel([], ["all"]), null);
  });

  it("mark where the medians change meaning", () => {
    assert.deepEqual(medianBreaks(points, i765), [
      {
        quarter: "2025-Q3",
        label: "split by category",
        text: "From Jul–Sep 2025, USCIS gives the I-765 numbers by category; before, it gave them only for all categories together.",
      },
    ]);
    const n400 = form("N-400", {
      "2025-Q1": [
        variant("civilian", { processingTime: 5 }),
        variant("military", { processingTime: 5 }),
      ],
      "2025-Q2": [
        variant("civilian", { processingTime: 5.5 }),
        variant("military", { processingTime: 5.5 }),
      ],
      "2025-Q3": [
        variant("civilian", { processingTime: 6 }),
        variant("military", { processingTime: 4 }),
      ],
    });
    assert.deepEqual(medianBreaks(toPoints(year, n400.quarters), n400), [
      {
        quarter: "2025-Q3",
        label: "separate medians",
        text: "Until Apr–Jun 2025, USCIS gave the Civilian and Military N-400 the same median, one figure for both; from Jul–Sep 2025 each has its own.",
      },
    ]);
  });
});

describe("the views of a form's page", () => {
  const i130 = form(
    "I-130",
    {
      "2025-Q1": [variant("all", { received: 100, pending: 500 })],
      "2025-Q2": [
        variant("immediate-relative", { received: 60, pending: 300 }),
        variant("all-other-relative", { received: 40, pending: 200 }),
      ],
    },
    {
      officeTotals: {
        "2025-Q1": {
          ...counts({ received: 100, pending: 500 }),
          categories: {
            "immediate-relative": counts({ received: 70, pending: 350 }),
            "all-other-relative": counts({ received: 30, pending: 150 }),
          },
        },
      },
    },
  );

  it("lead with the form's headline category, then the others, then the total", () => {
    assert.equal(focusCategory(i130, "2025-Q2"), "immediate-relative");
    assert.equal(focusCategory(i130, "2025-Q1"), null);
    const views = formViews(year, i130);
    assert.deepEqual(
      views.map(({ key }) => key),
      ["immediate-relative", "all-other-relative", ALL_CATEGORIES],
    );
    assert.equal(views[0].name, "Immediate Relative");
    assert.equal(views[2].name, "All categories");
    // before the split, the per-office report's national totals stand in
    assert.deepEqual(
      views[0].points.map(({ pending, fromOfficeReport }) => [
        pending,
        fromOfficeReport,
      ]),
      [
        [350, true],
        [300, false],
      ],
    );
    assert.equal(views[0].splitLabel, "Apr–Jun 2025");
    assert.deepEqual(views[0].processingTimeSeries, [
      { key: "immediate-relative", label: "Immediate Relative" },
      { key: "all", label: "All relatives (before the split)" },
    ]);
    assert.equal(views[1].splitLabel, "Apr–Jun 2025");
    assert.equal(views[2].splitLabel, null);
  });

  it("take the category received the most of when the headline one is missing", () => {
    const i131 = form("I-131", {
      "2025-Q1": [
        variant("a", { received: 10 }),
        variant("b", { received: 20 }),
      ],
    });
    assert.equal(focusCategory(i131, "2025-Q1"), "b");
    assert.deepEqual(
      formViews(year, i131).map(({ key }) => key),
      ["b", "a", ALL_CATEGORIES],
    );
  });

  it("are the total alone for a form with one category", () => {
    const i90 = form("I-90", { "2025-Q1": [variant("all")] });
    assert.deepEqual(
      formViews(year, i90).map(({ key }) => key),
      [ALL_CATEGORIES],
    );
    assert.deepEqual(categoryCounts(i90, "all").fromOfficeReport, []);
  });
});

describe("offices", () => {
  it("add several offices' counts up, counting a withheld one as a few", () => {
    const sums = sumCounts([
      {
        "2025-Q1": counts({
          received: 10,
          approved: 5,
          denied: null,
          pending: 100,
        }),
      },
      {
        "2025-Q1": {
          ...counts({
            received: 20,
            approved: null,
            denied: null,
            pending: 50,
          }),
          withheld: ["approved"],
        },
        "2025-Q2": counts({ pending: 7 }),
      },
    ]);
    assert.deepEqual(sums, {
      "2025-Q1": {
        received: 30,
        approved: 5 + WITHHELD_ESTIMATE,
        denied: null,
        pending: 150,
      },
      "2025-Q2": { received: 0, approved: 0, denied: 0, pending: 7 },
    });
  });

  it("read an office's quarters by category, without a flow check", () => {
    const quarters = {
      "2025-Q1": {
        ...counts({ pending: 100 }),
        categories: {
          family: counts({ pending: 60 }),
          employment: counts({ pending: 40 }),
        },
      },
      "2025-Q2": {
        ...counts({ pending: 120 }),
        categories: { family: counts({ pending: 80 }) },
      },
    };
    assert.deepEqual(officeCategoryCounts(quarters, "family"), {
      "2025-Q1": counts({ pending: 60 }),
      "2025-Q2": counts({ pending: 80 }),
    });
    assert.equal(officeCategoryCounts(quarters, ALL_CATEGORIES), quarters);
    assert.deepEqual(officePointOptions("I-130"), {
      checkFlow: false,
      boundedWithheld: false,
    });
    assert.deepEqual(officePointOptions("N-400"), {
      checkFlow: false,
      boundedWithheld: true,
    });
    const categories = [
      { key: "family", label: "Family-based" },
      { key: "employment", label: "Employment-based" },
      { key: "other", label: "Other" },
    ];
    const points = officeCategoryPoints(
      year,
      { form: "I-485", officeCategories: categories },
      quarters,
    );
    assert.deepEqual(
      points.map(({ category, points }) => [category.key, points.length]),
      [
        ["family", 2],
        ["employment", 1],
      ],
    );
    assert.deepEqual(
      officeCategoryPoints(
        year,
        { form: "I-90", officeCategories: categories },
        quarters,
      ),
      [],
    );
  });

  it("notice an office that approves almost none of a category", () => {
    assert.equal(
      rarelyApproves(point({ quarter: "q", approved: 5, denied: 312 })),
      true,
    );
    assert.equal(
      rarelyApproves(point({ quarter: "q", approved: 2, denied: 20 })),
      false,
    );
    assert.equal(
      rarelyApproves(
        point({ quarter: "q", approved: 5, denied: 312, approximate: true }),
      ),
      false,
    );
    assert.equal(rarelyApproves(undefined), false);
  });

  describe("open with", () => {
    const total = [
      point({ quarter: "2026-Q1", pending: 1000, approved: 500 }),
      point({ quarter: "2026-Q2", pending: 1000, approved: 500 }),
    ];
    const category = (
      key: string,
      fields: Parameters<typeof point>[0] extends infer T
        ? Omit<T, "quarter">
        : never,
    ) => ({
      key,
      points: [point({ quarter: "2026-Q2", ...fields })],
    });

    it("the leading category when it is a real part of the office's work", () => {
      assert.equal(
        openingOfficeCategory("I-485", total, [
          category("family", { pending: 200, approved: 100 }),
          category("employment", { pending: 800, approved: 400 }),
        ]),
        "family",
      );
      assert.equal(
        openingOfficeCategory("I-485", total, [
          category("family", { pending: 20, approved: 100 }),
          category("employment", { pending: 980, approved: 400 }),
        ]),
        "family",
      );
      assert.equal(
        openingOfficeCategory("N-400", total, [
          category("civilian", { pending: 1000, approved: 500 }),
        ]),
        ALL_CATEGORIES,
      );
      assert.equal(openingOfficeCategory("I-485", [], []), ALL_CATEGORIES);
    });

    it("otherwise the category the office decided the most of, that it approves some of", () => {
      assert.equal(
        openingOfficeCategory("I-485", total, [
          category("family", { pending: 20, approved: 10 }),
          category("employment", { pending: 900, approved: 400 }),
          category("other", { pending: 80, approved: 90 }),
        ]),
        "employment",
      );
      assert.equal(
        openingOfficeCategory("I-485", total, [
          category("family", { pending: 500, approved: 5, denied: 312 }),
          category("employment", { pending: 500, approved: 100 }),
        ]),
        "employment",
      );
      // none decided: the most pending
      assert.equal(
        openingOfficeCategory("I-485", total, [
          category("family", { pending: 20 }),
          category("employment", { pending: 900 }),
        ]),
        "employment",
      );
      // a pile nobody is working through does not lead
      assert.equal(
        openingOfficeCategory("I-485", total, [
          category("family", { pending: 900 }),
          category("employment", { pending: 100, approved: 19 }),
        ]),
        "employment",
      );
      assert.equal(openingOfficeCategory("I-485", total, []), ALL_CATEGORIES);
    });
  });
});
