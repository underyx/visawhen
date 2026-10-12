import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDays, addMonths } from "./dates";
import type { CategoryRange } from "./estimate";
import {
  type BulletinCell,
  caseNote,
  EMPTY_INPUTS,
  estimateTimeline,
  formatDateRange,
  formatDuration,
  inputsFromHash,
  inputsToHash,
  monthSpan,
  movementStat,
  pathBySlug,
  pathForms,
  pathMilestones,
  PATHS,
  type PathSpec,
  pathSummary,
  queuePace,
  type TimelineData,
  validMonth,
} from "./timeline";

const TODAY = "2026-10-10";

/** Formatted text with its non-breaking spaces as plain ones */
function plain(text: string | null | undefined): string {
  return (text ?? "").replace(/\u00a0/g, " ");
}

function range(
  key: string,
  name: string,
  median: number,
  q: number[],
  fields: Partial<CategoryRange> = {},
): CategoryRange {
  return {
    key,
    title: name,
    name,
    received: 1000,
    median,
    level: "typical",
    shock: false,
    shockRatio: 1,
    suppressed: null,
    priorityDate: false,
    premium: false,
    q,
    ...fields,
  };
}

/** Weekly readings ending on 2026-10-05, newest last */
function weekly(days: number[]): Record<string, number> {
  return Object.fromEntries(
    days.map((count, index) => [
      addDays("2026-10-05", -7 * (days.length - 1 - index)),
      count,
    ]),
  );
}

/** Enough data for every path: I-130 and I-485 ranges, NVC's readings,
 * two posts and the F4 and EB-2 cutoffs */
const DATA: TimelineData = {
  quarterLabel: "Apr–Jun 2026",
  ranges: {
    "I-130/immediate-relative": range(
      "immediate-relative",
      "Immediate Relative",
      13,
      [8, 11, 13, 22, 30],
    ),
    "I-130/all-other-relative": range(
      "all-other-relative",
      "All Other Relative",
      43.3,
      [20, 30, 43.3, 60, 80],
      { priorityDate: true },
    ),
    "I-485/family": range("family", "Family", 7, [4, 6, 7, 12, 18]),
    "I-129F/all": range("all", "I-129F", 9, [5, 7, 9, 11, 14]),
    "I-751/all": range("all", "I-751", 8, [4, 6, 8, 11, 16]),
    "I-765/adjustment-of-status": range(
      "adjustment-of-status",
      "Adjustment of Status",
      5,
      [2, 4, 5, 6, 8],
    ),
  },
  nvc: {
    creation: weekly([20, 27, 24]),
    review: weekly([55, 56, 62]),
  },
  posts: [
    {
      slug: "manila",
      name: "Manila",
      country: "Philippines",
      // the month moved forward 6 months in 11
      history: [
        ["2025-11-12", "2025-08"],
        ["2026-04-02", "2025-11"],
        ["2026-10-07", "2026-02"],
      ],
    },
    {
      slug: "london",
      name: "London",
      country: "United Kingdom",
      history: [
        ["2026-04-02", "2026-04"],
        ["2026-10-07", "2026-10"],
      ],
    },
    {
      slug: "stuck",
      name: "Stuck",
      country: null,
      history: [
        ["2025-11-12", "2025-01"],
        ["2026-10-07", "2024-12"],
      ],
    },
  ],
  ivAsOf: "2026-10-07",
  offices: null,
  bulletin: {
    month: "2026-10",
    categories: [
      { key: "F4", slug: "f4", name: "F4", who: "Siblings of US citizens" },
    ],
    areas: [{ key: "philippines", slug: "philippines", name: "Philippines" }],
    cells: {
      F4: {
        philippines: {
          final: "2008-05-15",
          filing: "2009-01-01",
          finalChange: { text: "+1 month since Sep", color: "teal.9" },
          filingChange: { text: "same as in Sep", color: "dimmed" },
          year: {
            from: ["2025-10", "2007-11-15"],
            to: ["2026-10", "2008-05-15"],
            months: 6,
            steady: false,
          },
          fiveYears: null,
        },
      },
    },
  },
};

const SPOUSE_ABROAD = pathBySlug("spouse-abroad") as PathSpec;
const FIANCE = pathBySlug("fiance") as PathSpec;
const OTHER_FAMILY = pathBySlug("other-family") as PathSpec;
const EMPLOYMENT = pathBySlug("employment") as PathSpec;

function stage(
  path: PathSpec,
  inputs: Partial<typeof EMPTY_INPUTS>,
  id: string,
) {
  const { stages } = estimateTimeline(
    path,
    DATA,
    { ...EMPTY_INPUTS, ...inputs },
    TODAY,
  );
  const result = stages.find((candidate) => candidate.spec.id === id);
  assert.ok(result !== undefined, `no stage ${id}`);
  return result;
}

describe("formatDuration", () => {
  it("gives days up to about four months, then months", () => {
    assert.equal(formatDuration({ low: 37, high: 87 }), "37–87 days");
    assert.equal(formatDuration({ low: 0, high: 0 }), "about 0 days");
    assert.equal(formatDuration({ low: 335, high: 670 }), "11–22 months");
  });
});

describe("formatDateRange", () => {
  it("gives months when the dates are far apart, else days", () => {
    assert.equal(
      plain(formatDateRange({ low: "2027-09-10", high: "2028-08-10" })),
      "Sep 2027 – Aug 2028",
    );
    assert.equal(
      plain(formatDateRange({ low: "2026-11-16", high: "2027-01-05" })),
      "Nov 16, 2026 – Jan 5, 2027",
    );
    assert.equal(
      plain(formatDateRange({ low: "2026-10-15", high: "2026-11-04" })),
      "Oct 15 – Nov 4, 2026",
    );
    assert.equal(
      plain(formatDateRange({ low: "2026-10-15", high: "2026-10-15" })),
      "Oct 15, 2026",
    );
  });
});

describe("validMonth", () => {
  it("takes a real month that is not in the future", () => {
    assert.equal(validMonth("2026-03", TODAY), "2026-03");
    assert.equal(validMonth("2026-10", TODAY), "2026-10");
    assert.equal(validMonth("2026-11", TODAY), null);
    assert.equal(validMonth("2026-13", TODAY), null);
    assert.equal(validMonth("2026-00", TODAY), null);
    assert.equal(validMonth("2026-03-14", TODAY), null);
    assert.equal(validMonth("", TODAY), null);
  });
});

describe("monthSpan", () => {
  it("stands for the whole month, up to today", () => {
    assert.deepEqual(monthSpan("2026-09", TODAY), {
      low: "2026-09-01",
      high: "2026-09-30",
    });
    assert.deepEqual(monthSpan("2026-10", TODAY), {
      low: "2026-10-01",
      high: TODAY,
    });
    assert.deepEqual(monthSpan("2024-02", null), {
      low: "2024-02-01",
      high: "2024-02-29",
    });
    assert.deepEqual(monthSpan("2025-12", TODAY), {
      low: "2025-12-01",
      high: "2025-12-31",
    });
  });
});

describe("pathMilestones", () => {
  it("lists the main line's milestones in order, not the side steps'", () => {
    assert.deepEqual(
      pathMilestones(FIANCE).map(({ id }) => id),
      [
        "i-129f-filed",
        "i-129f-approved",
        "k1-at-consulate",
        "k1-interview",
        "married",
        "i-485-filed",
        "i-485-approved",
      ],
    );
  });
});

describe("estimateTimeline", () => {
  it("gives durations while today is unknown", () => {
    const { stages, total } = estimateTimeline(
      SPOUSE_ABROAD,
      DATA,
      EMPTY_INPUTS,
      null,
    );
    assert.equal(
      plain(stages[0].headline),
      "Most likely 11–22 months after you file",
    );
    assert.equal(stages[0].end, null);
    assert.ok(stages.every(({ status }) => status === "ahead"));
    // the I-130, NVC's creation with a month for the transfer, and its
    // review; the interview needs a consulate
    assert.ok(total !== null);
    assert.equal(total.stage.spec.id, "nvc-review");
    assert.deepEqual(total.days, { low: 335 + 14 + 37, high: 670 + 64 + 87 });
  });

  it("dates a case started today from the ranges, step after step", () => {
    const i130 = stage(SPOUSE_ABROAD, {}, "i-130");
    assert.deepEqual(i130.end, {
      low: addMonths(TODAY, 11),
      high: addMonths(TODAY, 22),
    });
    assert.equal(plain(i130.headline), "Most likely Sep 2027 – Aug 2028");
    const creation = stage(SPOUSE_ABROAD, {}, "nvc-creation");
    assert.deepEqual(creation.start, i130.end);
    assert.deepEqual(creation.end, {
      low: addDays(addMonths(TODAY, 11), 14),
      high: addDays(addMonths(TODAY, 22), 64),
    });
  });

  it("marks the steps before a milestone done and starts the next one", () => {
    const inputs = { milestone: "nvc-created", date: "2026-08" };
    assert.equal(stage(SPOUSE_ABROAD, inputs, "i-130").status, "done");
    assert.equal(stage(SPOUSE_ABROAD, inputs, "nvc-creation").status, "done");
    // the visitor's own step is under way, and ends today at the earliest
    const documents = stage(SPOUSE_ABROAD, inputs, "documents");
    assert.equal(documents.status, "current");
    assert.deepEqual(documents.end, { low: TODAY, high: TODAY });
    const review = stage(SPOUSE_ABROAD, inputs, "nvc-review");
    assert.equal(review.status, "ahead");
    assert.deepEqual(review.end, {
      low: addDays(TODAY, 37),
      high: addDays(TODAY, 87),
    });
    assert.equal(
      plain(review.headline),
      "Most likely Nov 16, 2026 – Jan 5, 2027",
    );
  });

  it("reads a submission date with the /nvc range", () => {
    const review = stage(
      SPOUSE_ABROAD,
      { milestone: "documents-submitted", date: "2026-09" },
      "nvc-review",
    );
    assert.equal(review.status, "current");
    assert.deepEqual(review.start, { low: "2026-09-01", high: "2026-09-30" });
    assert.ok(review.end !== null);
    assert.ok(review.end.low >= TODAY);
    assert.match(review.headline, /^Most likely/);
  });

  it("says when a case has waited longer than the range, and counts the next step from today", () => {
    const inputs = { milestone: "i-130-filed", date: "2023-10" };
    const i130 = stage(SPOUSE_ABROAD, inputs, "i-130");
    assert.equal(i130.status, "current");
    assert.equal(i130.headline, "Longer than 9 in 10 cases");
    // 30 months from the last day of October 2023
    assert.equal(
      plain(i130.warning),
      "Nine in ten cases were decided by May 1, 2026. You can ask USCIS about a case outside its normal processing time: its processing times tool says from which date.",
    );
    // about this case, not news about the numbers: no chip
    assert.equal(i130.news, false);
    assert.equal(i130.warningLabel, null);
    assert.deepEqual(i130.end, { low: TODAY, high: TODAY });
    assert.deepEqual(stage(SPOUSE_ABROAD, inputs, "nvc-creation").start, {
      low: TODAY,
      high: TODAY,
    });
  });

  it("gives the wider range to a case past the most likely one", () => {
    // 11–22 average months from October 2024 ended by September 2026; the
    // 90th percentile, 30 months from its last day, is 2027-05-02
    const i130 = stage(
      SPOUSE_ABROAD,
      { milestone: "i-130-filed", date: "2024-10" },
      "i-130",
    );
    assert.equal(plain(i130.headline), "Most likely by May 2, 2027");
    assert.deepEqual(i130.end, {
      low: TODAY,
      high: addMonths("2024-10-31", 30),
    });
  });

  it("starts a USCIS form the visitor has not filed today, not on the milestone", () => {
    const i485 = stage(
      FIANCE,
      { milestone: "married", date: "2026-09" },
      "i-485",
    );
    assert.equal(i485.status, "ahead");
    assert.deepEqual(i485.start, { low: TODAY, high: TODAY });
    // the work permit runs alongside it
    const ead = stage(
      FIANCE,
      { milestone: "married", date: "2026-09" },
      "i-765",
    );
    assert.deepEqual(ead.start, i485.start);
  });

  it("says a side step is 'after you file', a gated step its median, and the visitor's own nothing", () => {
    const { stages } = estimateTimeline(FIANCE, DATA, EMPTY_INPUTS, null);
    const ead = stages.find(({ spec }) => spec.id === "i-765");
    assert.equal(plain(ead?.headline), "Most likely 4–6 months after you file");
    // USCIS decides the I-130 first; the wait for the date comes after
    const i130 = stage(OTHER_FAMILY, {}, "i-130");
    assert.equal(
      i130.headline,
      "USCIS’s median: 43.3 months, then you wait for your priority date",
    );
    assert.equal(
      i130.basis[0],
      "USCIS’s approval is only the first step. When your relative can immigrate depends on the priority date.",
    );
    // an I-485 waits for the date before USCIS can decide it
    const employment = estimateTimeline(
      EMPLOYMENT,
      {
        ...DATA,
        ranges: {
          ...DATA.ranges,
          "I-485/employment": range(
            "employment",
            "Employment",
            6,
            [3, 5, 6, 9, 12],
            { priorityDate: true },
          ),
        },
      },
      EMPTY_INPUTS,
      null,
    );
    const i485 = employment.stages.find(({ spec }) => spec.id === "i-485");
    assert.equal(
      i485?.headline,
      "USCIS’s median: 6.0 months, once your date is current",
    );
    assert.deepEqual(i485?.basis, [
      "USCIS can approve the I-485 only once your priority date is current, so your wait depends on it. USCIS’s median counts only cases whose dates were already current.",
    ]);
    assert.equal(stage(SPOUSE_ABROAD, {}, "documents").headline, "");
  });

  it("asks for the consulate before estimating the interview", () => {
    const interview = stage(SPOUSE_ABROAD, {}, "interview");
    assert.equal(interview.needs, "consulate");
    assert.equal(interview.end, null);
  });

  it("estimates the interview from the queue as it is and its pace", () => {
    const interview = stage(
      SPOUSE_ABROAD,
      {
        milestone: "documentarily-complete",
        date: "2026-09",
        post: "manila",
      },
      "interview",
    );
    assert.equal(interview.status, "current");
    // the queue as it is: 8 months behind the update of 2026-10-07, from
    // the first of the month
    assert.equal(interview.end?.low, addMonths("2026-09-01", 8));
    // its pace: 6 months forward in 11, so September 2026, 7 months past
    // February, is reached 7 / (6 / 11) months after the update
    assert.equal(
      interview.end?.high,
      addDays("2026-10-07", Math.round((7 / (6 / 11)) * 30.44)),
    );
    assert.equal(plain(interview.headline), "Most likely May – Nov 2027");
    assert.equal(interview.warning, null);
  });

  it("says when NVC is already scheduling the case's month", () => {
    const interview = stage(
      SPOUSE_ABROAD,
      {
        milestone: "documentarily-complete",
        date: "2026-02",
        post: "manila",
      },
      "interview",
    );
    assert.equal(interview.headline, "NVC may be scheduling your case now");
    assert.deepEqual(interview.end, { low: TODAY, high: TODAY });
  });

  it("counts no wait at a post listed as current", () => {
    const interview = stage(
      SPOUSE_ABROAD,
      {
        milestone: "documentarily-complete",
        date: "2026-09",
        post: "london",
      },
      "interview",
    );
    assert.deepEqual(interview.end, { low: TODAY, high: TODAY });
    assert.match(interview.headline, /listed as current/);
  });

  it("warns when a post's month has moved back", () => {
    const interview = stage(
      SPOUSE_ABROAD,
      {
        milestone: "documentarily-complete",
        date: "2026-09",
        post: "stuck",
      },
      "interview",
    );
    assert.match(interview.warning ?? "", /has not moved forward/);
    // our reading of the numbers, for now: a warning chip
    assert.equal(interview.news, true);
    assert.equal(interview.warningLabel, "Queue not moving");
    // the queue as it is only: 22 months from each end of the month
    assert.deepEqual(interview.end, {
      low: addMonths("2026-09-01", 22),
      high: addMonths("2026-09-30", 22),
    });
  });

  it("labels the chip of an old NVC reading and of USCIS deciding fewer cases", () => {
    // five weeks after the newest reading
    const { stages } = estimateTimeline(
      SPOUSE_ABROAD,
      DATA,
      EMPTY_INPUTS,
      "2026-11-10",
    );
    const creation = stages.find(({ spec }) => spec.id === "nvc-creation");
    assert.equal(creation?.news, true);
    assert.equal(creation?.warningLabel, "Our data may be old");
    assert.match(creation?.warning ?? "", /may be out of date/);
    const fewer: TimelineData = {
      ...DATA,
      ranges: {
        "I-130/immediate-relative": range(
          "immediate-relative",
          "Immediate Relative",
          13,
          [8, 11, 13, 22, 30],
          { shock: true, shockRatio: 0.6 },
        ),
      },
    };
    const i130 = estimateTimeline(SPOUSE_ABROAD, fewer, EMPTY_INPUTS, TODAY)
      .stages[0];
    assert.equal(i130.news, true);
    assert.equal(i130.warningLabel, "USCIS deciding fewer cases");
    assert.match(i130.warning ?? "", /^USCIS decided 40% fewer/);
  });

  it("gives no arrival date for a priority date, and reads it from the I-130", () => {
    const inputs = {
      milestone: "i-130-filed",
      date: "2012-05",
      category: "F4",
      area: "philippines",
    };
    const priority = stage(OTHER_FAMILY, inputs, "priority-date");
    assert.equal(
      priority.headline,
      "Final Action Date May 15, 2008 in the October 2026 Visa Bulletin",
    );
    assert.equal(priority.end, null);
    assert.match(priority.basis[0], /May 2012, is 4 years after the cutoff/);
    assert.match(priority.basis[priority.basis.length - 1], /does not guess/);
    // and nothing after it is dated
    assert.equal(stage(OTHER_FAMILY, inputs, "i-485").start, null);
    assert.equal(
      estimateTimeline(
        OTHER_FAMILY,
        DATA,
        { ...EMPTY_INPUTS, ...inputs },
        TODAY,
      ).total,
      null,
    );
  });

  it("calls a priority date current when it is before the cutoff", () => {
    const priority = stage(
      OTHER_FAMILY,
      { category: "F4", area: "philippines", priorityDate: "2007-01" },
      "priority-date",
    );
    assert.match(priority.headline, /^Your priority date is current/);
  });

  it("cannot tell when the cutoff is in the priority date's month", () => {
    const priority = stage(
      OTHER_FAMILY,
      { category: "F4", area: "philippines", priorityDate: "2008-05" },
      "priority-date",
    );
    assert.equal(
      priority.headline,
      "Your priority date is at the cutoff, May 15, 2008",
    );
    assert.match(priority.basis[0], /current if it is earlier than/);
  });
});

describe("inputsToHash", () => {
  it("is empty when nothing is filled in", () => {
    assert.equal(inputsToHash(EMPTY_INPUTS), "");
  });
  it("names each answer in plain words", () => {
    assert.equal(
      inputsToHash({
        milestone: "documentarily-complete",
        date: "2026-09",
        post: "manila",
        office: "san-francisco-ca",
        category: "F4",
        area: "philippines",
        priorityDate: "2008-05",
      }),
      "#milestone=documentarily-complete&date=2026-09&consulate=manila&office=san-francisco-ca&category=F4&country=philippines&priority=2008-05",
    );
  });
});

describe("inputsFromHash", () => {
  const allowed = {
    milestone: ["documentarily-complete", "sent-to-nvc"],
    post: ["manila", "london"],
    office: ["san-francisco-ca"],
    category: ["F4"],
    area: ["philippines"],
  };
  it("round-trips the answers", () => {
    const inputs = {
      milestone: "documentarily-complete",
      date: "2026-09",
      post: "manila",
      office: "san-francisco-ca",
      category: "F4",
      area: "philippines",
      priorityDate: "2008-05",
    };
    assert.deepEqual(inputsFromHash(inputsToHash(inputs), allowed), inputs);
  });
  it("drops what the page does not offer", () => {
    assert.deepEqual(
      inputsFromHash(
        "#milestone=interview-scheduled&date=2026-09&consulate=paris&office=&category=F4&country=mars&priority=2008-13&extra=1",
        allowed,
      ),
      { ...EMPTY_INPUTS, category: "F4" },
    );
  });
  it("keeps a date only with its milestone", () => {
    assert.deepEqual(inputsFromHash("#date=2026-09", allowed), EMPTY_INPUTS);
    assert.deepEqual(
      inputsFromHash("#milestone=sent-to-nvc&date=2026-09", allowed),
      { ...EMPTY_INPUTS, milestone: "sent-to-nvc", date: "2026-09" },
    );
  });
  it("reads the full dates of links made before months as their months", () => {
    assert.deepEqual(
      inputsFromHash(
        "#milestone=sent-to-nvc&date=2026-09-15&priority=2008-05-15",
        allowed,
      ),
      {
        ...EMPTY_INPUTS,
        milestone: "sent-to-nvc",
        date: "2026-09",
        priorityDate: "2008-05",
      },
    );
    assert.deepEqual(
      inputsFromHash("#milestone=sent-to-nvc&date=2026-02-30", allowed),
      { ...EMPTY_INPUTS, milestone: "sent-to-nvc" },
    );
  });
  it("is empty for an empty or unknown fragment", () => {
    assert.deepEqual(inputsFromHash("", allowed), EMPTY_INPUTS);
    assert.deepEqual(inputsFromHash("#spouse-abroad", allowed), EMPTY_INPUTS);
  });
});

describe("queuePace", () => {
  it("measures the month's move over about the last year", () => {
    const manila = DATA.posts?.find(({ slug }) => slug === "manila");
    assert.ok(manila !== undefined);
    assert.deepEqual(queuePace(manila), {
      from: ["2025-11-12", "2025-08"],
      moved: 6,
      over: 11,
    });
  });

  it("is null without an update that far back, or without a month", () => {
    assert.equal(
      queuePace({
        slug: "new",
        name: "New",
        country: null,
        history: [["2026-10-07", "2026-02"]],
      }),
      null,
    );
    assert.equal(
      queuePace({
        slug: "na",
        name: "N/A",
        country: null,
        history: [
          ["2025-11-12", "2025-08"],
          ["2026-10-07", null],
        ],
      }),
      null,
    );
  });
});

describe("movementStat", () => {
  const cell = (
    year: BulletinCell["year"],
    fiveYears: BulletinCell["fiveYears"] = null,
  ): BulletinCell => ({
    final: "2008-05-15",
    filing: "2009-01-01",
    finalChange: null,
    filingChange: null,
    year,
    fiveYears,
  });
  const moved = (
    from: string,
    to: string,
    months: number | null,
    steady = false,
  ) => ({
    from: ["2025-10", from] as [string, string],
    to: ["2026-10", to] as [string, string],
    months,
    steady,
  });

  it("signs the year's move, with a real minus sign", () => {
    assert.deepEqual(movementStat(cell(moved("2007-11-15", "2008-05-15", 6))), {
      value: "+6 months",
      notShown: null,
      line: null,
      lineColor: "dimmed",
    });
    assert.deepEqual(
      movementStat(cell(moved("2008-08-15", "2008-05-15", -3))),
      {
        value: "−3 months",
        notShown: null,
        line: null,
        lineColor: "dimmed",
      },
    );
    assert.equal(
      movementStat(cell(moved("2008-05-15", "2008-05-15", 0))).value,
      "0 months",
    );
    assert.equal(
      movementStat(cell(moved("2005-03-15", "2008-05-15", 38))).value,
      "+3 years and 2 months",
    );
  });

  it("puts the 5-year move under it, coloured by its own sign", () => {
    const forward = movementStat(
      cell(
        moved("2008-08-15", "2008-05-15", -3),
        moved("2005-11-15", "2008-05-15", 30),
      ),
    );
    assert.equal(forward.value, "−3 months");
    assert.equal(forward.line, "+2 years and 6 months in 5 years");
    assert.equal(forward.lineColor, "teal.9");
    const back = movementStat(
      cell(
        moved("2008-05-15", "2008-05-15", 0),
        moved("2008-07-15", "2008-05-15", -2),
      ),
    );
    assert.equal(back.line, "−2 months in 5 years");
    assert.equal(back.lineColor, "red.9");
    const still = movementStat(
      cell(
        moved("2008-05-15", "2008-05-15", 0),
        moved("2008-05-15", "2008-05-15", 0),
      ),
    );
    assert.equal(still.line, "0 months in 5 years");
    assert.equal(still.lineColor, "dimmed");
    // a 5-year move with a Current end has no distance to show
    assert.equal(
      movementStat(
        cell(
          moved("2008-08-15", "2008-05-15", -3),
          moved("C", "2008-05-15", null),
        ),
      ).line,
      null,
    );
  });

  it("says it is not known yet without a bulletin a year back", () => {
    assert.deepEqual(movementStat(cell(null)), {
      value: null,
      notShown: "Not known yet",
      line: null,
      lineColor: "dimmed",
    });
    assert.equal(
      movementStat(cell(null, moved("2005-11-15", "2008-05-15", 30))).line,
      "+2 years and 6 months in 5 years",
    );
  });

  it("says what the cutoff was when either end is Current or Unavailable", () => {
    // Current is the front of the line: a date now is a move back
    assert.deepEqual(movementStat(cell(moved("C", "2008-05-15", null))), {
      value: null,
      notShown: "was current",
      line: "a year ago",
      lineColor: "red.9",
    });
    assert.deepEqual(movementStat(cell(moved("U", "2008-05-15", null))), {
      value: null,
      notShown: "was unavailable",
      line: "a year ago",
      lineColor: "teal.9",
    });
    assert.deepEqual(movementStat(cell(moved("2024-06-01", "C", null))), {
      value: null,
      notShown: "was Jun 1, 2024",
      line: "a year ago",
      lineColor: "teal.9",
    });
    assert.equal(
      movementStat(cell(moved("2024-06-01", "U", null))).lineColor,
      "red.9",
    );
  });

  it("says a line has been Current or Unavailable all year", () => {
    assert.deepEqual(movementStat(cell(moved("C", "C", null, true))), {
      value: null,
      notShown: "Current all year",
      line: null,
      lineColor: "dimmed",
    });
    assert.equal(
      movementStat(cell(moved("U", "U", null, true))).notShown,
      "Unavailable all year",
    );
    // the same at both ends, with a date in between, is not all year
    assert.deepEqual(movementStat(cell(moved("C", "C", null, false))), {
      value: null,
      notShown: "was current too",
      line: "a year ago",
      lineColor: "dimmed",
    });
  });
});

describe("pathSummary", () => {
  it("is one line on the path's first steps, with 'most likely' once", () => {
    assert.equal(
      plain(pathSummary(SPOUSE_ABROAD, DATA)),
      "I-130 most likely 11–22 months, NVC 37–87 days, then the interview queue at your consulate.",
    );
    assert.equal(
      plain(pathSummary(OTHER_FAMILY, DATA)),
      "Your priority date, often years, then I-485 most likely 6–12 months.",
    );
    assert.equal(
      plain(pathSummary(FIANCE, DATA)),
      "I-129F most likely 7–11 months, then I-485 6–12 months.",
    );
  });
});

describe("cases", () => {
  it("lists the paths' branches, none of them a step", () => {
    const labels = Object.fromEntries(
      PATHS.map(({ slug, cases }) => [slug, cases.map(({ label }) => label)]),
    );
    assert.deepEqual(labels, {
      "spouse-abroad": ["Married under 2 years"],
      "spouse-in-us": ["Entered without inspection", "Married under 2 years"],
      fiance: ["Married under 2 years"],
      citizenship: [],
      employment: ["EB-1: no PERM", "Premium processing", "Living abroad"],
      "other-family": ["Living abroad"],
      temporary: [],
    });
    for (const { stages } of PATHS)
      assert.ok(
        stages.every(({ id }) => id !== "i-751" && id !== "abroad"),
        "the I-751 and the consular route are cases, not steps",
      );
  });

  it("adds the I-751's current range to its note, when there is one", () => {
    const [i751] = SPOUSE_ABROAD.cases;
    assert.equal(
      plain(caseNote(i751, DATA)),
      "Your green card is valid for 2 years. File the I-751 in the 90 days before it expires. USCIS most likely decides it in 6–11 months.",
    );
    assert.equal(
      caseNote(i751, { ...DATA, ranges: {} }),
      "Your green card is valid for 2 years. File the I-751 in the 90 days before it expires.",
    );
    // the K-1 wording, with the same figure
    assert.match(plain(caseNote(FIANCE.cases[0], DATA)), /^Most K-1 couples/);
    assert.match(plain(caseNote(FIANCE.cases[0], DATA)), /6–11 months\.$/);
  });

  it("leaves the figure out of a note when its range shows none", () => {
    const [i751] = SPOUSE_ABROAD.cases;
    const bare =
      "Your green card is valid for 2 years. File the I-751 in the 90 days before it expires.";
    const withRange = (fields: Partial<CategoryRange>) => ({
      ...DATA,
      ranges: {
        ...DATA.ranges,
        "I-751/all": { ...DATA.ranges["I-751/all"], ...fields },
      },
    });
    assert.equal(
      caseNote(i751, withRange({ suppressed: "too few decisions" })),
      bare,
    );
    assert.equal(caseNote(i751, withRange({ priorityDate: true })), bare);
  });

  it("names the I-751 among the forms a page needs ranges for", () => {
    assert.deepEqual(pathForms(SPOUSE_ABROAD), [
      { form: "I-130", category: "immediate-relative" },
      { form: "I-751", category: "all" },
    ]);
  });
});
