import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FAMILIES,
  bestReports,
  calendarQuarter,
  gridOf,
  parseAllFormsGrid,
  parseAllFormsLines,
  parseCounts,
  parseOfficeGrid,
  parseOfficeLines,
  parseValue,
  rejoinNumbers,
  reportFromUrl,
  restoreX,
  roundHalfEven,
  toJson,
  type Report,
} from "./forms";

const DATA = "https://www.uscis.gov/sites/default/files/document/data";

describe("reportFromUrl", () => {
  it("reads the family, fiscal quarter and format from the file name", () => {
    assert.deepEqual(
      reportFromUrl(
        `http://www.uscis.gov/sites/default/files/document/data/I130_performancedata_fy2020_qtr1.pdf?x=1`,
      ),
      {
        family: "I-130",
        fiscalYear: 2020,
        fiscalQuarter: 1,
        priority: 2,
        url: `${DATA}/I130_performancedata_fy2020_qtr1.pdf`,
      },
    );
    assert.equal(
      reportFromUrl(`${DATA}/Quarterly_All_Forms_FY19Q4.pdf`)?.fiscalYear,
      2019,
    );
  });

  it("leaves out other files, other hosts and reports before FY2014", () => {
    assert.equal(
      reportFromUrl(`${DATA}/Appropriation_Requirement_November_2022.csv`),
      null,
    );
    assert.equal(
      reportFromUrl("https://example.com/n400_performancedata_fy2024_q1.xlsx"),
      null,
    );
    assert.equal(
      reportFromUrl(`${DATA}/N400_performancedata_fy2013_qtr4.csv`),
      null,
    );
  });
});

describe("bestReports", () => {
  it("prefers a complete, newer, final and more structured file", () => {
    const urls = [
      `${DATA}/i130_performancedata_fy2024_q1.csv`,
      `${DATA}/i130_performancedata_fy2024_q1.xlsx`,
      `${DATA}/i130_performancedata_fy2024_q1_v2.csv`,
      `${DATA}/i130_performancedata_state_fy2024_q1_v3.xlsx`,
      `${DATA}/n400_performancedata_fy2023_q4.pdf`,
    ];
    const reports = urls.map((url) => reportFromUrl(url)!);
    assert.deepEqual(
      bestReports(reports).map((report: Report) => report.url),
      [
        `${DATA}/i130_performancedata_fy2024_q1_v2.csv`,
        `${DATA}/n400_performancedata_fy2023_q4.pdf`,
      ],
    );
  });
});

describe("calendarQuarter", () => {
  it("maps a fiscal quarter to its calendar quarter and days", () => {
    const [key, start, end] = calendarQuarter(2026, 1);
    assert.deepEqual(
      [key, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)],
      ["2025-Q4", "2025-10-01", "2025-12-31"],
    );
    assert.equal(
      calendarQuarter(2024, 2)[2].toISOString().slice(0, 10),
      "2024-03-31",
    );
  });
});

describe("parseValue and parseCounts", () => {
  it("reads counts, dashes as zero, and withheld values as unknown", () => {
    assert.equal(parseValue("1,925,486"), 1925486);
    assert.equal(parseValue("-"), 0);
    assert.equal(parseValue("D"), null);
    assert.equal(parseValue("N/A"), null);
  });

  it("rounds fractional counts half to even, as the Python version did", () => {
    assert.equal(parseValue("59172.344"), 59172);
    assert.equal(roundHalfEven(2.5), 2);
    assert.equal(roundHalfEven(3.5), 4);
  });

  it("marks withheld counts, and a dash pending as unknown where asked", () => {
    const counts = parseCounts(["12", "D", "3", "-"], true)!;
    assert.deepEqual(counts.values, [12, null, 3, null]);
    assert.deepEqual([...counts.withheld], ["approved"]);
    assert.equal(parseCounts(["12", "x", "3", "4"]), null);
    assert.equal(parseCounts(["", "", "", ""]), null);
  });
});

describe("rejoinNumbers", () => {
  it("joins the digits a PDF split apart where only one reading adds up", () => {
    const total = (values: string[]) =>
      parseValue(values[0])! + parseValue(values[1])! === parseValue(values[2]);
    assert.deepEqual(rejoinNumbers(["1", ",925", "75", "2,000"], 3, total), [
      "1,925",
      "75",
      "2,000",
    ]);
    assert.equal(rejoinNumbers(["1", "2", "3", "4"], 3), null);
  });
});

describe("restoreX", () => {
  it("puts back the x that one report's text layer wrote as N/A", () => {
    assert.equal(
      restoreX("TeN/Aas TEN/A N/A PhoeniN/A"),
      "Texas TEX N/A Phoenix",
    );
  });
});

describe("parseOfficeGrid", () => {
  it("reads offices, states, codes, categories and the total", () => {
    const grid = gridOf(
      "csv",
      new TextEncoder().encode(
        [
          ",,,Immediate Relative1,,,,All Other Relative,,,,Total,,,",
          "State,Office,Code,Received,Approved,Denied,Pending,Received,Approved,Denied,Pending,Received,Approved,Denied,Pending",
          "Total,,,10,5,1,20,4,2,D,8,14,7,1,28",
          "Arizona,,,,,,,,,,,,,,",
          ",Phoenix,PHO,10,5,1,20,4,2,D,8,14,7,1,28",
        ].join("\n"),
      ),
    );
    const report = parseOfficeGrid(grid);
    assert.deepEqual(report.categories, [
      "Immediate Relative",
      "All Other Relative",
    ]);
    assert.equal(report.totals.length, 1);
    assert.deepEqual(
      report.offices.map((row) => [
        row.state,
        row.name,
        row.code,
        row.counts.values,
      ]),
      [["Arizona", "Phoenix", "PHO", [14, 7, 1, 28]]],
    );
    assert.deepEqual(
      [...report.offices[0].categories[1]!.withheld],
      ["denied"],
    );
  });
});

describe("parseOfficeLines", () => {
  it("reads PDF lines with codes, and the service centers of the older reports", () => {
    const report = parseOfficeLines(
      [
        "Total 1 0 0 1 1 0 0 1 2 0 0 2",
        "Texas",
        "El Paso ELP 1 0 0 1 1 0 0 1 2 0 0 2",
        "Service Center",
        "California 3 0 0 3 0 0 0 0 3 0 0 3",
      ],
      FAMILIES["N-400"],
    );
    assert.deepEqual(
      report.offices.map((row) => [row.state, row.name, row.code]),
      [
        ["Texas", "El Paso", "ELP"],
        [null, "California", "WSC"],
      ],
    );
    assert.equal(report.totals[0].counts.values[0], 2);
  });
});

describe("parseAllFormsGrid", () => {
  it("reads the quarter's columns, categories and processing times", () => {
    const report = reportFromUrl(`${DATA}/quarterly_all_forms_fy2025_q3.csv`)!;
    const grid = [
      ["", "", "3rd Quarter", "", "", "", "", "Fiscal Year to Date"],
      [
        "Category",
        "Form",
        "Received",
        "Approved",
        "Denied",
        "Pending",
        "Median Processing Time",
        "Received",
      ],
      [
        "Family-Based",
        "I-130",
        "Petition for Alien Relative",
        "100",
        "50",
        "5",
        "1,000",
        "15.5",
        "300",
      ],
      [
        "",
        "I-129F",
        "Petition for Alien Fiancé(e)",
        "10",
        "5",
        "D",
        "-",
        "N/A",
        "30",
      ],
    ].map((row, i) => (i < 2 ? ["", ...row] : row));
    const rows = parseAllFormsGrid(report, grid);
    assert.deepEqual(
      rows.map((row) => [
        row.fiscalQuarter,
        row.form,
        row.category,
        row.counts.values,
        row.processingTime,
      ]),
      [
        [3, "I-130", "Family-Based", [100, 50, 5, 1000], 15.5],
        [3, "I-129F", "Family-Based", [10, 5, null, null], null],
      ],
    );
  });
});

describe("parseAllFormsLines", () => {
  it("reads the cumulative PDF layout, with split digits", () => {
    const report = reportFromUrl(`${DATA}/Quarterly_All_Forms_FY2020Q2.pdf`)!;
    const rows = parseAllFormsLines(report, [
      "Family Based",
      "I-130 Petition for Alien Relative 1 00 50 5 1,000 200 100 10 1,100 300 150",
    ]);
    assert.deepEqual(
      rows.map((row) => [
        row.fiscalQuarter,
        row.form,
        row.title,
        row.counts.values,
      ]),
      [
        [1, "I-130", "Petition for Alien Relative", [100, 50, 5, 1000]],
        [2, "I-130", "Petition for Alien Relative", [200, 100, 10, 1100]],
      ],
    );
  });
});

describe("toJson", () => {
  it("sorts keys and keeps a short list of strings on one line", () => {
    assert.equal(
      toJson({ b: ["x", "y"], a: { d: 1, c: null } }),
      '{\n  "a": {\n    "c": null,\n    "d": 1\n  },\n  "b": ["x", "y"]\n}',
    );
  });
});
