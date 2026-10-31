import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  matchSlugs,
  parseLastUpdated,
  parseMonth,
  parsePage,
} from "./iv_schedule";

describe("parseMonth", () => {
  it("reads months with two- and four-digit years", () => {
    assert.equal(parseMonth("Feb-26"), "2026-02");
    assert.equal(parseMonth("Feb-2026"), "2026-02");
    assert.equal(parseMonth("N/A"), null);
  });

  it("refuses what is not a month", () => {
    assert.throws(() => parseMonth("Sept-26"));
  });
});

describe("parseLastUpdated", () => {
  it("reads the spellings State has used", () => {
    assert.equal(
      parseLastUpdated("Last Updated: September 23, 2026"),
      "2026-09-23",
    );
    assert.equal(parseLastUpdated("Last Updated: Sept. 23 2026"), "2026-09-23");
    assert.equal(parseLastUpdated("Last Updated: 9/23/2026"), "2026-09-23");
  });

  it("needs exactly one date", () => {
    assert.throws(() => parseLastUpdated("no date"));
    assert.throws(() =>
      parseLastUpdated("Last Updated: 9/23/2026 Last Updated: 9/24/2026"),
    );
  });
});

describe("parsePage", () => {
  it("reads the table", () => {
    const [asOf, posts] = parsePage(`<p>Last Updated: October 7, 2026</p><table>
      <tr><th>Post</th><th>Employment Visa</th><th>Preference Visa</th><th>Relative Visa</th></tr>
      <tr><td>Mumbai (Bombay)</td><td>Oct-26</td><td>Jan-2025</td><td>N/A</td></tr>
      <tr><td>null</td><td>N/A</td><td>N/A</td><td>N/A</td></tr></table>`);
    assert.equal(asOf, "2026-10-07");
    assert.deepEqual(
      [...posts],
      [["Mumbai (Bombay)", ["2026-10", "2025-01", null]]],
    );
  });
});

describe("matchSlugs", () => {
  it("matches by letters, or by alias", () => {
    const [matched, unmatched] = matchSlugs(
      ["Mumbai (Bombay)", "Ho Chi Minh City", "Atlantis", "constructor"],
      ["mumbai", "ho-chi-minh-city"],
    );
    assert.deepEqual(
      [...matched],
      [
        ["Mumbai (Bombay)", "mumbai"],
        ["Ho Chi Minh City", "ho-chi-minh-city"],
      ],
    );
    assert.deepEqual(unmatched, ["Atlantis", "constructor"]);
  });
});
