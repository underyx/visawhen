import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  descriptionsOf,
  mergeClasses,
  ndjsonLine,
  normalizeUrl,
  pdfLinks,
  rowsOfLines,
  slugify,
  tables,
  urlsByMonth,
} from "./visa_issuances";

describe("rowsOfLines", () => {
  it("reads post, class and count, skipping headers and the grand total", () => {
    assert.deepEqual(
      rowsOfLines([
        "Post Visa Class Issuances",
        "Abidjan A1 3",
        "Port Au Prince CR1 1,234Immigrant Visa Issuances by Post",
        "GRAND TOTAL 99",
        "Grand Total 12,345",
        "Page 2 of 40",
      ]),
      [
        ["Abidjan", "A1", 3],
        ["Port Au Prince", "CR1", 1234],
      ],
    );
  });
});

describe("pdfLinks and urlsByMonth", () => {
  it("finds the by-post-and-class reports in the content body", () => {
    const page = `<a href="/outside.pdf">March 2019 - IV Issuances by Post and Visa Class</a>
      <div class="contentbody">
        <a href="/content/dam/a/MARCH%202019%20-%20IV.pdf">March   2019 - IV Issuances by Post and Visa Class</a>
        <a href="b.pdf">February 2021 – NIV Issuances by Post and Visa Cass</a>
        <a href="c.pdf">March 2019 - IV Issuances by FSC and Visa Class</a>
        <a href="d.html">March 2019 - NIV Issuances by Post and Visa Class</a>
      </div>`;
    const links = pdfLinks(
      "https://travel.state.gov/content/x/page.html",
      page,
    );
    assert.deepEqual(
      [...urlsByMonth(links)],
      [
        [
          "IV-2019-03",
          "https://travel.state.gov/content/dam/a/MARCH%202019%20-%20IV.pdf",
        ],
        ["NIV-2021-02", "https://travel.state.gov/content/x/b.pdf"],
      ],
    );
  });

  it("matches listing links to Wayback captures however they are quoted", () => {
    assert.equal(
      normalizeUrl("https://Travel.state.gov/a%20b.pdf"),
      normalizeUrl("http://travel.state.gov/a b.pdf"),
    );
  });
});

describe("mergeClasses and tables", () => {
  const issuance = (
    post: string,
    visaType: "IV" | "NIV",
    visaClass: string,
    month: string,
    issuances: number,
  ) => ({
    post,
    visaType,
    visaClass,
    month,
    issuances,
  });

  it("merges codes and post names, and fills the months without rows with 0", () => {
    const merged = mergeClasses([
      issuance("Budapest", "IV", "IR1", "2026-01-01", 2),
      issuance("Budapest", "IV", "CR1", "2026-01-01", 3),
      issuance("Mumbai (Bombay)", "NIV", "B1", "2026-01-01", 10),
      issuance("Mumbai", "NIV", "B2", "2026-03-01", 5),
    ]);
    const rows = tables(
      merged,
      new Map([["cr1ir1", "Spouse"]]),
      new Map([
        ["b1b2", "Visitor"],
        ["cr1ir1", "x"],
      ]),
    );
    assert.deepEqual(rows.post_slugs, [
      ["budapest", "Budapest"],
      ["mumbai", "Mumbai"],
    ]);
    assert.deepEqual(rows.visa_slugs, [
      ["cr1ir1", "CR1/IR1", "IV", "Spouse"],
      ["b1b2", "B1/B2", "NIV", "Visitor"],
    ]);
    assert.deepEqual(rows.backlogs, [
      ["budapest", "cr1ir1", "2026-01-01 00:00:00", 5],
      ["budapest", "cr1ir1", "2026-02-01 00:00:00", 0],
      ["budapest", "cr1ir1", "2026-03-01 00:00:00", 0],
      ["mumbai", "b1b2", "2026-01-01 00:00:00", 10],
      ["mumbai", "b1b2", "2026-02-01 00:00:00", 0],
      ["mumbai", "b1b2", "2026-03-01 00:00:00", 5],
    ]);
  });

  it("refuses an immigrant and a nonimmigrant class of one name", () => {
    assert.throws(() =>
      mergeClasses([
        issuance("Lagos", "IV", "Q1", "2026-01-01", 1),
        issuance("Lagos", "NIV", "Q1", "2026-01-01", 1),
      ]),
    );
  });
});

describe("slugify", () => {
  it("makes the slugs the pages are keyed by", () => {
    assert.equal(slugify("F1 (family)"), "f1-family");
    assert.equal(slugify("CR1/IR1"), "cr1ir1");
    assert.equal(slugify("Port-au-Prince"), "port-au-prince");
    assert.equal(slugify("Rio de Janeiro"), "rio-de-janeiro");
  });
});

describe("descriptionsOf", () => {
  it("reads the descriptions by slug, leaving out missing ones", () => {
    const csv =
      'Visa Class Slug,Description\na1,"Ambassador, or family"\nb2,\nc3,N/A\n';
    assert.deepEqual(
      [...descriptionsOf(csv)],
      [["a1", "Ambassador, or family"]],
    );
  });
});

describe("ndjsonLine", () => {
  it("writes a row as Python's json.dumps did", () => {
    assert.equal(
      ndjsonLine(["sao-paulo", "São Paulo", null, 3]),
      '["sao-paulo", "S\\u00e3o Paulo", null, 3]',
    );
  });
});
