import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDays,
  endOfMonth,
  type Freshness,
  issueBody,
  reportRows,
  status,
} from "./freshness";

const source = (staleFrom: string): Freshness => ({
  source: "NVC timeframes",
  newest: "2026-10-26",
  staleFrom,
  cadence: "Weekly.",
  where: "Look here.",
  workflow: "nvc_update_schedule.yml",
});

describe("dates", () => {
  it("counts days and ends months, running into the next year", () => {
    assert.equal(addDays("2026-12-25", 14), "2027-01-08");
    assert.equal(endOfMonth(2026, 2), "2026-02-28");
    assert.equal(endOfMonth(2026, 14), "2027-02-28");
  });
});

describe("status and reportRows", () => {
  it("calls a source stale, due soon or current", () => {
    assert.equal(status(source("2026-11-09"), "2026-11-09"), "stale");
    assert.equal(status(source("2026-11-09"), "2026-11-02"), "due soon");
    assert.equal(status(source("2026-11-09"), "2026-11-01"), "current");
    assert.deepEqual(
      reportRows([source("9999-12-31")], "2026-11-01")[0].stale_from,
      null,
    );
  });
});

describe("issueBody", () => {
  it("says since when the data is stale and where to look", () => {
    const body = issueBody(source("2026-11-09"), "2026-11-10", null);
    assert.match(body, /It became stale on 2026-11-09, 1 day ago\./);
    assert.match(
      body,
      /Look here\.\n\nLast checked 2026-11-10 by the freshness workflow/,
    );
  });
});
