import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compare,
  formatMonth,
  n400Message,
  nvcMessage,
  payload,
  roles,
} from "./notify";

describe("nvcMessage", () => {
  it("compares each timeframe's newest reading with the one before", () => {
    const before = {
      review: { "2026-10-19": 56 },
      creation: { "2026-10-19": 9 },
      inquiry: { "2026-10-19": 8 },
    };
    const after = {
      review: { "2026-10-19": 56, "2026-10-26": 62 },
      creation: { "2026-10-19": 9, "2026-10-26": 5 },
      inquiry: { "2026-10-19": 8 },
    };
    assert.deepEqual(nvcMessage(before, after)?.lines, [
      ["Document review", "\u{1F534} 56 → 62 days"],
      ["Case creation", "\u{1F7E2} 9 → 5 days"],
      ["Inquiry response", "⚪ 8 days (no update)"],
    ]);
    assert.equal(nvcMessage(after, after), null);
  });
});

describe("n400Message", () => {
  const month = (averageMonths: number, pending: number, approved: number) => ({
    forms: { "N-400": { all: { averageMonths, pending, approved } } },
  });

  it("compares the newest month with the month before, only when it is new", () => {
    const before = { months: { "2026-07": month(11.4, 778489, 16514) } };
    const after = {
      months: { ...before.months, "2026-08": month(12.7, 813453, 15349) },
    };
    assert.deepEqual(n400Message(before, after), {
      title: "New N-400 numbers for August 2026",
      lines: [
        ["Processing time", "\u{1F534} 11.4 → 12.7 months"],
        ["Pending applications", "\u{1F7E1} 778,489 → 813,453"],
        ["Approved", "\u{1F534} 16,514 → 15,349"],
      ],
    });
    assert.equal(n400Message(after, after), null);
  });
});

describe("formatting", () => {
  it("writes months, missing numbers and whole processing times", () => {
    assert.equal(formatMonth("2026-01"), "January 2026");
    assert.equal(
      compare(null, 5, (value) => String(value)),
      "⚪ 5",
    );
    assert.equal(compare(5, null, String), "⚪ no number");
  });
});

describe("roles and payload", () => {
  it("reads role IDs, even ones written as bare numbers, and pings only that role", () => {
    const known = roles('{"nvc-watch": 1558910798469013635}');
    assert.equal(known.get("nvc-watch"), "1558910798469013635");
    const body = payload(
      { title: "New NVC numbers", lines: [["Case creation", "x"]] },
      "https://visawhen.com/nvc",
      "1",
    );
    assert.equal(body.content, "New NVC numbers: Case creation x <@&1>");
    assert.deepEqual(body.allowed_mentions, { parse: [], roles: ["1"] });
  });
});
