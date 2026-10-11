import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDays,
  addMonths,
  daysBetween,
  formatDate,
  formatDateRange,
  formatMonthDay,
  formatMonthRange,
  formatMonthYear,
  formatShortDate,
} from "./dates";

/** A string with its non-breaking spaces made plain, for comparing */
function plain(text: string): string {
  return text.replace(/ /g, " ");
}

describe("daysBetween", () => {
  it("counts whole days, negative when `to` is earlier", () => {
    assert.equal(daysBetween("2026-07-13", "2026-09-24"), 73);
    assert.equal(daysBetween("2026-09-24", "2026-07-13"), -73);
    assert.equal(daysBetween("2026-09-24", "2026-09-24"), 0);
  });
  it("crosses years and leap days", () => {
    assert.equal(daysBetween("2023-12-31", "2024-03-01"), 61);
  });
});

describe("addDays", () => {
  it("moves across month and year ends", () => {
    assert.equal(addDays("2026-07-13", -33), "2026-06-10");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2024-02-28", 1), "2024-02-29");
    assert.equal(addDays("2026-01-01", 0), "2026-01-01");
  });
});

describe("addMonths", () => {
  it("counts average months of 30.44 days", () => {
    assert.equal(addMonths("2026-09-24", 11.2), "2027-08-31");
    assert.equal(addMonths("2026-09-24", 0), "2026-09-24");
  });
});

describe("formatting", () => {
  it("formats dates in UTC", () => {
    assert.equal(formatDate("2026-07-13"), "July 13, 2026");
    assert.equal(formatShortDate("2026-07-13"), "Jul 13, 2026");
    assert.equal(formatMonthDay("2026-07-13"), "Jul 13");
    assert.equal(formatMonthYear("2027-08-31"), "Aug 2027");
  });
  it("formats a range of dates as days, or as months when far apart", () => {
    assert.equal(
      plain(formatDateRange({ low: "2026-10-15", high: "2026-11-04" })),
      "Oct 15 – Nov 4, 2026",
    );
    assert.equal(
      plain(formatDateRange({ low: "2026-11-16", high: "2027-01-05" })),
      "Nov 16, 2026 – Jan 5, 2027",
    );
    assert.equal(
      plain(formatDateRange({ low: "2026-10-15", high: "2026-10-15" })),
      "Oct 15, 2026",
    );
    assert.equal(
      plain(formatDateRange({ low: "2027-09-10", high: "2028-08-10" })),
      "Sep 2027 – Aug 2028",
    );
  });
  it("formats a range of months, keeping each month with its year", () => {
    assert.equal(
      formatMonthRange("2027-08-01", "2028-07-15"),
      "Aug 2027 – Jul 2028",
    );
    assert.equal(
      formatMonthRange("2027-04-01", "2027-09-15"),
      "Apr – Sep 2027",
    );
    assert.equal(formatMonthRange("2027-04-01", "2027-04-30"), "Apr 2027");
  });
});
