import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDate, parsePage } from "./main";

describe("parseDate", () => {
  it("reads State's day-month-year dates", () => {
    assert.equal(
      parseDate("21-Sep-26").toISOString(),
      "2026-09-21T00:00:00.000Z",
    );
    assert.equal(
      parseDate("1-September-2026").toISOString(),
      "2026-09-01T00:00:00.000Z",
    );
  });

  it("refuses what is not a date", () => {
    assert.throws(() => parseDate("31-Feb-26"));
    assert.throws(() => parseDate("21-Sept-26"));
  });
});

describe("parsePage", () => {
  it("reads each timeframe's date and backlog in days", () => {
    const html = `<p>Current case creation time frame: As of 26-Oct-26, we are working on cases that were received from USCIS on 17-Oct-26.</p>
      <p>Current case review time: As of 26-Oct-26, we are reviewing documents submitted to us on 18-Aug-26.</p>`;
    assert.deepEqual(parsePage(html), {
      creation: ["2026-10-26", 9],
      review: ["2026-10-26", 69],
    });
  });

  it("reads through no-break spaces", () => {
    const html =
      "As&nbsp;of 26-Oct-26, we are responding to inquiries received on 16-Oct-26.";
    assert.deepEqual(parsePage(html), { inquiry: ["2026-10-26", 10] });
  });
});
