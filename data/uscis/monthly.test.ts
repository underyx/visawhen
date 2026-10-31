import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listedReports, nextMonth, parseReport, urljoin } from "./monthly";

const FORMS = [
  "I-130,Petition for Alien Relative",
  'I-360,"Petition for Amerasian, Widow(er), or Special Immigrant"',
  "I-485,Application to Register Permanent Residence or Adjust Status (Family)",
  "I-751,Petition to Remove Conditions on Residence",
  "I-765,Application for Employment Authorization",
  "N-400,Application for Naturalization",
];

function report(lines: string[]): Uint8Array {
  return new TextEncoder().encode(
    [
      "Report to Congress,,,,,,,",
      "For the Month of August 2026,,,,,,,",
      "Form Number,Description,Forms Received,Approvals,Denials,Pending,Pending Over Six Months,Avg. Processing Time",
      ...lines,
    ].join("\r\n"),
  );
}

describe("parseReport", () => {
  it("reads the month, each form's row and the notes about the month", () => {
    const [month, forms, notes] = parseReport(
      report([
        ...FORMS.map((form) => `${form},"1,234",500,60,"20,000","8,000",6.1`),
        ",,,,,,,",
        "Notes:,,,,,,,",
        "1) A standard note,,,,,,,",
        '"12) This month,   USCIS changed something",,,,,,,',
      ]),
    );
    assert.equal(month, "2026-08");
    assert.deepEqual(Object.keys(forms), [
      "I-130",
      "I-360",
      "I-485",
      "I-751",
      "I-765",
      "N-400",
    ]);
    assert.deepEqual(forms["I-485"].family, {
      title:
        "Application to Register Permanent Residence or Adjust Status (Family)",
      received: 1234,
      approved: 500,
      denied: 60,
      pending: 20000,
      pendingOver6Months: 8000,
      averageMonths: 6.1,
    });
    assert.deepEqual(notes, ["This month, USCIS changed something"]);
  });

  it("fails on a form or a column it does not know", () => {
    assert.throws(() =>
      parseReport(
        report([
          ...FORMS.map((form) => `${form},1,1,1,1,1,1`),
          "I-999,New,1,1,1,1,1,1",
        ]),
      ),
    );
    assert.throws(() =>
      parseReport(report(FORMS.slice(1).map((form) => `${form},1,1,1,1,1,1`))),
    );
  });
});

describe("listedReports", () => {
  it("finds the report links by their month", () => {
    const html = `<a href="/sites/default/files/document/data/Appropriation_Requirement_August_2026.csv">Application Processing Data for August 2026</a>
      <a href="/other">Other</a>`;
    assert.deepEqual(
      [...listedReports(html)],
      [
        [
          "2026-08",
          "https://www.uscis.gov/sites/default/files/document/data/Appropriation_Requirement_August_2026.csv",
        ],
      ],
    );
  });
});

describe("urljoin and nextMonth", () => {
  it("resolves links and steps months", () => {
    assert.equal(
      urljoin("https://www.uscis.gov/a/b", "c.csv"),
      "https://www.uscis.gov/a/c.csv",
    );
    assert.equal(
      urljoin("https://www.uscis.gov/a/b", "/c.csv"),
      "https://www.uscis.gov/c.csv",
    );
    assert.equal(nextMonth("2026-12"), "2027-01");
    assert.equal(nextMonth("2026-08"), "2026-09");
  });
});
