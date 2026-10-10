import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Form, Variant } from "../api/uscis";
import {
  CALIBRATION,
  casesMovedQuarters,
  categoryMovedQuarters,
  categoryRanges,
  clearingSuppressed,
  compareClearing,
  decisionShock,
  formatMedian,
  formatRangeMonths,
  fourQuarterClearing,
  headlineRange,
  movedDirection,
  planningRange,
  premiumCategory,
  pressureLevel,
  routedQuarters,
  withoutMisleadingClearing,
} from "./estimate";
import { point } from "./testing";

function variant(
  key: string,
  fields: Partial<Variant> & { processingTime: number | null },
): Variant {
  return {
    key,
    title: `Form (${key
      .replace(/\b[a-z]/g, (c) => c.toUpperCase())
      .replace(/-/g, " ")})`,
    received: 1000,
    approved: 600,
    denied: 100,
    pending: 2000,
    ...fields,
  };
}

/** A form from its rows per quarter, "2026-Q2" */
function form(number: string, quarters: Record<string, Variant[]>): Form {
  return {
    form: number,
    slug: number.toLowerCase(),
    title: `Form ${number}`,
    category: null,
    quarters: Object.fromEntries(
      Object.entries(quarters).map(([quarter, variants]) => [
        quarter,
        {
          received: null,
          approved: null,
          denied: null,
          pending: null,
          variants,
        },
      ]),
    ),
    sources: {},
    offices: [],
    officeTotals: {},
    officeSources: {},
  };
}

describe("pressureLevel", () => {
  it("compares the time to clear the backlog with 1.75 times the median", () => {
    assert.equal(pressureLevel(26.3, 10), "high");
    assert.equal(pressureLevel(26.25, 10), "typical");
    assert.equal(pressureLevel(17.5, 10), "typical");
    assert.equal(pressureLevel(11.67, 10), "typical");
    assert.equal(pressureLevel(11.6, 10), "low");
  });
  it("is typical when there is nothing to compare", () => {
    assert.equal(pressureLevel(null, 10), "typical");
    assert.equal(pressureLevel(30, 0), "typical");
  });
});

describe("decisionShock", () => {
  it("trips when decisions fell below 60% of the four quarters before", () => {
    assert.deepEqual(decisionShock([100, 100, 100, 100, 50]), {
      shock: true,
      ratio: 0.5,
    });
    assert.deepEqual(decisionShock([100, 100, 100, 100, 60]), {
      shock: false,
      ratio: 0.6,
    });
    assert.deepEqual(decisionShock([50, 100, 100, 100, 100, 70]), {
      shock: false,
      ratio: 0.7,
    });
  });
  it("needs all four quarters before, and some decisions in them", () => {
    assert.deepEqual(decisionShock([100, 100, 100, 50]), {
      shock: false,
      ratio: null,
    });
    assert.deepEqual(decisionShock([100, null, 100, 100, 50]), {
      shock: false,
      ratio: null,
    });
    assert.deepEqual(decisionShock([100, 100, 100, 100, null]), {
      shock: false,
      ratio: null,
    });
    assert.deepEqual(decisionShock([0, 0, 0, 0, 0]), {
      shock: false,
      ratio: null,
    });
    assert.deepEqual(decisionShock([]), { shock: false, ratio: null });
  });
});

describe("planningRange and premiumCategory", () => {
  it("multiplies the median by the calibration row", () => {
    assert.deepEqual(
      planningRange(10, "typical"),
      CALIBRATION.typical.map((m) => m * 10),
    );
    assert.equal(planningRange(10, "typical")[2], 9.8);
    assert.deepEqual(
      planningRange(2, "high"),
      CALIBRATION.high.map((m) => m * 2),
    );
  });
  it("knows the forms USCIS premium-processes", () => {
    assert.equal(premiumCategory("I-129", "h1b"), true);
    assert.equal(premiumCategory("I-765", "adjustment-of-status"), false);
    assert.equal(premiumCategory("N-400", "civilian"), false);
  });
});

describe("categoryRanges", () => {
  it("works out a range for each category with a median", () => {
    const ranges = categoryRanges(
      form("I-130", {
        "2026-Q2": [
          variant("immediate-relative", {
            approved: 600,
            denied: 100,
            pending: 7000,
            processingTime: 10,
          }),
          variant("all-other-relative", {
            received: 500,
            pending: 1000,
            processingTime: 20,
          }),
          variant("unknown", { processingTime: null }),
        ],
      }),
    );
    assert.deepEqual(
      ranges.map(
        ({ key, name, level, suppressed, priorityDate, premium, shock }) => ({
          key,
          name,
          level,
          suppressed,
          priorityDate,
          premium,
          shock,
        }),
      ),
      [
        {
          key: "immediate-relative",
          name: "Immediate Relative",
          level: "high",
          suppressed: null,
          priorityDate: false,
          premium: false,
          shock: false,
        },
        {
          key: "all-other-relative",
          name: "All Other Relative",
          level: "low",
          suppressed: null,
          priorityDate: true,
          premium: false,
          shock: false,
        },
      ],
    );
    // 7,000 pending at 700 decisions a quarter: 30 months, 1.7 times the
    // usual 1.75 medians
    assert.deepEqual(
      ranges[0].q,
      CALIBRATION.high.map((m) => m * 10),
    );
    assert.equal(ranges[0].median, 10);
    assert.equal(ranges[0].received, 1000);
  });

  it("names a form's only category after the form", () => {
    const [range] = categoryRanges(
      form("N-565", { "2026-Q2": [variant("all", { processingTime: 4 })] }),
    );
    assert.equal(range.name, "N-565");
  });

  it("suppresses a range on too few decisions, or when decisions nearly stopped", () => {
    const few = categoryRanges(
      form("I-90", {
        "2026-Q2": [
          variant("all", { approved: 60, denied: 30, processingTime: 4 }),
        ],
      }),
    );
    assert.equal(few[0].suppressed, "too few decisions");
    const quarters = Object.fromEntries(
      ["2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1"].map((quarter) => [
        quarter,
        [variant("all", { approved: 900, denied: 100, processingTime: 4 })],
      ]),
    );
    const stopped = categoryRanges(
      form("I-589", {
        ...quarters,
        "2026-Q2": [
          variant("all", { approved: 100, denied: 50, processingTime: 4 }),
        ],
      }),
    );
    assert.equal(stopped[0].suppressed, "nearly stopped");
    assert.equal(stopped[0].shock, true);
    assert.equal(stopped[0].shockRatio, 0.15);
    assert.equal(stopped[0].level, "high");
    const slowed = categoryRanges(
      form("I-589", {
        ...quarters,
        "2026-Q2": [
          variant("all", { approved: 300, denied: 100, processingTime: 4 }),
        ],
      }),
    );
    assert.equal(slowed[0].suppressed, null);
    assert.equal(slowed[0].shock, true);
    assert.equal(slowed[0].level, "high");
  });

  it("gives a premium-processed category the typical row instead of the low one", () => {
    const [range] = categoryRanges(
      form("I-129", {
        "2026-Q2": [
          variant("all", {
            approved: 900,
            denied: 100,
            pending: 100,
            processingTime: 9,
          }),
        ],
      }),
    );
    assert.equal(range.premium, true);
    assert.equal(range.level, "typical");
  });

  it("is empty for a form without quarters", () => {
    assert.deepEqual(categoryRanges(form("I-130", {})), []);
  });
});

describe("headlineRange", () => {
  const i130 = form("I-130", {
    "2026-Q2": [
      variant("immediate-relative", {
        received: 100,
        approved: 60,
        denied: 30,
        processingTime: 10,
      }),
      variant("all-other-relative", { received: 5000, processingTime: 20 }),
    ],
  });

  it("leads with the form's own headline category, or nothing", () => {
    // immediate relatives have too few decisions: no other category stands in
    assert.equal(headlineRange(categoryRanges(i130), "I-130"), null);
    const ranges = categoryRanges(
      form("I-130", {
        "2026-Q2": [variant("immediate-relative", { processingTime: 10 })],
      }),
    );
    assert.equal(headlineRange(ranges, "I-130")?.key, "immediate-relative");
  });

  it("otherwise leads with the category received the most of that has a range", () => {
    const ranges = categoryRanges(
      form("I-131", {
        "2026-Q2": [
          variant("travel-document", { received: 100, processingTime: 5 }),
          variant("humanitarian-parole", {
            received: 9000,
            approved: 10,
            denied: 10,
            processingTime: 5,
          }),
          variant("parole-in-place", { received: 500, processingTime: 5 }),
        ],
      }),
    );
    assert.equal(headlineRange(ranges, "I-131")?.key, "parole-in-place");
    assert.equal(headlineRange([], "I-131"), null);
  });
});

describe("formatting", () => {
  it("rounds a range to whole months, or tenths under three months", () => {
    assert.equal(formatRangeMonths(11.4, 22.3), "11–22 months");
    assert.equal(formatRangeMonths(2.8, 5.5), "2.8–5.5 months");
    assert.equal(formatRangeMonths(11.6, 12.4), "about 12 months");
    assert.equal(formatRangeMonths(11.6, 12.4, "weeks"), "about 12 weeks");
    assert.equal(formatMedian(13), "13.0 months");
  });
});

describe("cases moved between offices", () => {
  const total = [
    point({ quarter: "2025-Q3", pending: 1000 }),
    point({ quarter: "2025-Q4", pending: 2100 }),
    point({ quarter: "2026-Q1", pending: 2000 }),
    point({ quarter: "2026-Q2", pending: 900 }),
    point({ quarter: "2026-Q3", pending: 950 }),
  ];

  it("are the quarters in which the pile more than doubled or halved", () => {
    assert.deepEqual(casesMovedQuarters(total), ["2025-Q4", "2026-Q2"]);
    assert.deepEqual(casesMovedQuarters(total, 1200), []);
    assert.deepEqual(
      casesMovedQuarters([
        point({ quarter: "2025-Q3", pending: 10 }),
        point({ quarter: "2025-Q4", pending: 50 }),
      ]),
      [],
    );
  });

  it("include a category's own jumps, and filings routed to it", () => {
    const steady = [
      point({ quarter: "2025-Q3", pending: 10000 }),
      point({ quarter: "2025-Q4", pending: 10500 }),
    ];
    const routed = [
      point({ quarter: "2025-Q3", pending: 1000, received: 100 }),
      point({ quarter: "2025-Q4", pending: 1600, received: 250 }),
    ];
    assert.deepEqual(categoryMovedQuarters(steady, routed), ["2025-Q4"]);
    const grew = [
      point({ quarter: "2025-Q3", pending: 1000, received: 100 }),
      point({ quarter: "2025-Q4", pending: 1600, received: 150 }),
    ];
    assert.deepEqual(categoryMovedQuarters(steady, grew), []);
    const small = [
      point({ quarter: "2025-Q3", pending: 100, received: 10 }),
      point({ quarter: "2025-Q4", pending: 400, received: 50 }),
    ];
    assert.deepEqual(categoryMovedQuarters(steady, small), []);
    assert.deepEqual(categoryMovedQuarters(total, routed), [
      "2025-Q4",
      "2026-Q2",
    ]);
  });

  it("say which way the cases went", () => {
    const moved = casesMovedQuarters(total);
    assert.equal(movedDirection(total, moved, "2025-Q4"), "in");
    assert.equal(movedDirection(total, moved, "2026-Q2"), "out");
    assert.equal(movedDirection(total, moved, "2026-Q1"), null);
    assert.equal(movedDirection(total, ["2025-Q3"], "2025-Q3"), null);
  });

  it("tell filings routed to the office from cases moved there", () => {
    const points = [
      point({ quarter: "2025-Q3", pending: 1000, received: 1000 }),
      point({ quarter: "2025-Q4", pending: 2100, received: 1600 }),
      point({ quarter: "2026-Q1", pending: 2000, received: 1600 }),
      point({ quarter: "2026-Q2", pending: 900, received: 2000 }),
    ];
    assert.deepEqual(routedQuarters(points, ["2025-Q4", "2026-Q2"]), [
      "2025-Q4",
    ]);
    assert.deepEqual(
      routedQuarters(
        [
          point({ quarter: "2025-Q3", received: 50 }),
          point({ quarter: "2025-Q4", received: 120 }),
        ],
        ["2025-Q4"],
      ),
      [],
    );
  });
});

describe("the time to clear the backlog", () => {
  it("is withheld on fewer than 100 decisions", () => {
    assert.equal(
      clearingSuppressed(
        point({ quarter: "q", approved: 50, denied: 49, pending: 1000 }),
      ),
      "too few decisions",
    );
    assert.equal(
      clearingSuppressed(point({ quarter: "q", approved: 100, pending: 1000 })),
      null,
    );
    assert.equal(
      clearingSuppressed(
        point({ quarter: "q", completions: null, pending: 1000 }),
      ),
      null,
    );
    const points = [
      point({ quarter: "q1", approved: 50, pending: 1000 }),
      point({ quarter: "q2", approved: 500, pending: 1000 }),
    ];
    assert.deepEqual(
      withoutMisleadingClearing(points).map(({ waitMonths }) => waitMonths),
      [null, 6],
    );
  });

  it("is steadier over four quarters", () => {
    const points = [
      point({ quarter: "q1", approved: 300, pending: 900 }),
      point({ quarter: "q2", approved: 300, pending: 1000 }),
      point({ quarter: "q3", approved: 300, pending: 1100, approximate: true }),
      point({ quarter: "q4", approved: 300, pending: 1200 }),
      point({ quarter: "q5", approved: 20, pending: 1200 }),
    ];
    assert.deepEqual(fourQuarterClearing(points, "q4"), {
      months: 12,
      approximate: true,
    });
    assert.deepEqual(fourQuarterClearing(points, "q5"), {
      months: 1200 / (920 / 12),
      approximate: true,
    });
    assert.equal(fourQuarterClearing(points, "q3"), null);
    assert.equal(fourQuarterClearing(points, "q9"), null);
    const unknown = [
      ...points.slice(0, 3),
      point({ quarter: "q4", completions: null, pending: 1200 }),
    ];
    assert.equal(fourQuarterClearing(unknown, "q4"), null);
    const few = points.map((p) => ({ ...p, completions: 20 }));
    assert.equal(fourQuarterClearing(few, "q4"), null);
  });

  it("is compared with the national one at 1.5 times", () => {
    assert.equal(compareClearing(16, 10), "longer");
    assert.equal(compareClearing(15, 10), "close");
    assert.equal(compareClearing(7, 10), "close");
    assert.equal(compareClearing(6, 10), "shorter");
  });
});
