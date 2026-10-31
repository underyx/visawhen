import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addMonths, bulletinPath, parsePage, parseValue } from "./bulletin";

describe("parseValue", () => {
  it("reads C, U and dates with two-digit years", () => {
    assert.equal(parseValue("C", 2026), "C");
    assert.equal(parseValue("u*", 2026), "U");
    assert.equal(parseValue("01 JAN 08", 2026), "2008-01-01");
    assert.equal(parseValue("22NOV94", 2015), "1994-11-22");
  });

  it("refuses what is not a cell", () => {
    assert.throws(() => parseValue("soon", 2026));
    assert.throws(() => parseValue("31FEB20", 2026));
  });
});

describe("months", () => {
  it("counts across years", () => {
    assert.equal(addMonths("2026-01", -1), "2025-12");
    assert.equal(addMonths("2026-11", 2), "2027-01");
  });

  it("puts a bulletin in its fiscal year's folder", () => {
    assert.match(
      bulletinPath("2026-10"),
      /\/2027\/visa-bulletin-for-october-2026\.html$/,
    );
    assert.match(
      bulletinPath("2026-09"),
      /\/2026\/visa-bulletin-for-september-2026\.html$/,
    );
  });
});

const chart = (heading: string, rows: string[][]) =>
  `<table><tr><td>${heading}</td><td>All Chargeability Areas Except Those Listed</td><td>CHINA-mainland born</td></tr>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("")}</table>`;

describe("parsePage", () => {
  const family = chart("Family-Sponsored", [
    ["F1", "08JAN16", "C"],
    ["F2A", "01FEB24", "U"],
  ]);
  const employment = chart("Employment-based", [
    ["1st", "C", "15FEB23"],
    ["5th Unreserved (including C5, T5, I5, R5)", "C", "01JAN16"],
  ]);

  it("reads the Final Action Dates and Dates for Filing charts", () => {
    const [finalAction, datesForFiling] = parsePage(
      `<html><body>${family}${employment}<table><tr><td><table></table></td></tr></table>${family}${employment}</body></html>`,
      "2026-10",
    );
    assert.deepEqual(finalAction, {
      F1: { all: "2016-01-08", china: "C" },
      F2A: { all: "2024-02-01", china: "U" },
      "EB-1": { all: "C", china: "2023-02-15" },
      "EB-5-unreserved": { all: "C", china: "2016-01-01" },
    });
    assert.deepEqual(datesForFiling, finalAction);
  });

  it("fails on a category it does not know", () => {
    assert.throws(
      () =>
        parsePage(
          `${family}${chart("Employment-based", [
            ["1st", "C", "C"],
            ["6th", "C", "C"],
          ])}${family}${employment}`,
          "2026-10",
        ),
      /unknown category "6th"/,
    );
  });
});
