import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MonthlyData, MonthlyRow } from "../api/uscis";
import { MONTHLY_MONTHS, monthlyNumbers } from "./monthlyNumbers";

function row(fields: Partial<MonthlyRow> = {}): MonthlyRow {
  return {
    title: "A row",
    received: 100,
    approved: 60,
    denied: 20,
    pending: 400,
    pendingOver6Months: 50,
    averageMonths: 5,
    ...fields,
  };
}

const months = [
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
];
const data: MonthlyData = {
  source: "https://example.org/",
  months: Object.fromEntries(
    months.map((month, index) => [
      month,
      {
        url: `https://example.org/${month}`,
        forms: {
          "I-485": {
            family: row({
              pending: 1000 + index * 20,
              approved: 80,
              denied: 20,
            }),
            employment: row({ pending: 2000, approved: 100, denied: 50 }),
          },
          "N-400": {
            all: row({
              pending: 5000,
              received: 600,
              approved: 500,
              denied: 100,
            }),
          },
        },
        ...(month === "2026-08"
          ? { notes: ["USCIS changed how it counts."] }
          : {}),
      },
    ]),
  ),
};

describe("monthlyNumbers", () => {
  it("shows the newest months of a form's only row for all categories", () => {
    const numbers = monthlyNumbers(data, "N-400", "total");
    assert.ok(numbers !== null);
    assert.equal(numbers.points.length, MONTHLY_MONTHS);
    assert.deepEqual(
      numbers.points.map(({ quarter }) => quarter),
      months.slice(-MONTHLY_MONTHS),
    );
    assert.equal(numbers.points[0].label, "Mar 2026");
    const newest = numbers.points[numbers.points.length - 1];
    assert.equal(newest.completions, 600);
    assert.equal(newest.waitMonths, 5000 / 600);
    assert.equal(newest.approvalRate, 500 / 600);
    assert.equal(newest.flow, "consistent");
    assert.equal(numbers.source, "https://example.org/2026-08");
    assert.deepEqual(numbers.notes, [
      { label: "Aug 2026", text: "USCIS changed how it counts." },
    ]);
  });

  it("adds a form's categories up for all categories, or shows one of them", () => {
    const total = monthlyNumbers(data, "I-485", "total");
    assert.ok(total !== null);
    const newest = total.points[total.points.length - 1];
    assert.equal(newest.pending, 1140 + 2000);
    assert.equal(newest.received, 200);
    assert.equal(newest.completions, 250);
    const family = monthlyNumbers(data, "I-485", "family");
    assert.ok(family !== null);
    assert.equal(family.points[family.points.length - 1].pending, 1140);
    assert.equal(family.points[family.points.length - 1].flow, "consistent");
  });

  it("is null for a form or a category the report does not cover", () => {
    assert.equal(monthlyNumbers(data, "I-130", "total"), null);
    assert.equal(monthlyNumbers(data, "N-400", "civilian"), null);
    assert.equal(monthlyNumbers(data, "I-485", "asylum"), null);
  });

  it("checks the pending counts against the months before the ones shown", () => {
    const jump: MonthlyData = {
      ...data,
      months: {
        ...data.months,
        "2026-03": {
          ...data.months["2026-03"],
          forms: {
            ...data.months["2026-03"].forms,
            "N-400": {
              all: row({
                pending: 9000,
                received: 600,
                approved: 500,
                denied: 100,
              }),
            },
          },
        },
      },
    };
    const numbers = monthlyNumbers(jump, "N-400", "total");
    assert.ok(numbers !== null);
    assert.equal(numbers.points[0].quarter, "2026-03");
    assert.equal(numbers.points[0].flow, "inconsistent");
    assert.equal(numbers.points[0].suspect, true);
    assert.equal(numbers.points[1].suspect, false);
  });
});
