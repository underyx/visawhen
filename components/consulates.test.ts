import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applicantCountry,
  countToolClassIssuances,
  describeInactivity,
  describeIvPostElsewhere,
  formatCount,
  formatIvMonth,
  formatLongMonth,
  formatMonth,
  formatMonthlyRate,
  formatShortIvMonth,
  IV_CATEGORY_BY_CLASS,
  IV_POSTS_ELSEWHERE,
  monthsBehind,
  summarizeInactivity,
  summarizeIvPostElsewhere,
} from "./consulates";

describe("formatting", () => {
  it("writes a monthly rate compactly", () => {
    assert.equal(formatMonthlyRate(undefined), "0/mo");
    assert.equal(formatMonthlyRate(0), "0/mo");
    assert.equal(formatMonthlyRate(0.14), "0.1/mo");
    assert.equal(formatMonthlyRate(8.5), "8.5/mo");
    assert.equal(formatMonthlyRate(9.95), "10/mo");
    assert.equal(formatMonthlyRate(462), "462/mo");
    assert.equal(formatMonthlyRate(999.6), "1K/mo");
    assert.equal(formatMonthlyRate(1540), "1.5K/mo");
    assert.equal(formatMonthlyRate(57800), "57.8K/mo");
  });
  it("names the data's months in UTC", () => {
    assert.equal(formatMonth("2025-09-01T00:00:00.000Z"), "Sep 2025");
    assert.equal(formatLongMonth("2025-09-01T00:00:00.000Z"), "September 2025");
    assert.equal(formatIvMonth("2026-02"), "February 2026");
    assert.equal(formatShortIvMonth("2026-02"), "Feb 2026");
    assert.equal(formatCount(5538.4), "5,538");
  });
  it("counts the months a tool month is behind its update", () => {
    assert.equal(monthsBehind("2026-09-23", "2026-02"), 7);
    assert.equal(monthsBehind("2026-01-15", "2025-11"), 2);
  });
});

describe("describeInactivity", () => {
  const input = {
    postName: "Nicosia",
    dataStart: "2019-01-01T00:00:00.000Z",
    dataEnd: "2026-02-01T00:00:00.000Z",
    immigrant: true,
    listedInTool: true,
  };

  it("says when a post issued no visas at all in the last 12 months", () => {
    const activity = {
      lastIssued: "2024-11-01T00:00:00.000Z",
      lastImmigrantIssued: "2024-11-01T00:00:00.000Z",
    };
    assert.equal(
      describeInactivity({ ...input, activity }),
      "Nicosia has not issued any visas since November 2024, in State Department figures up to February 2026.",
    );
    assert.equal(
      summarizeInactivity({ ...input, activity }),
      "no visas issued since November 2024",
    );
  });

  it("says when it issued no immigrant visas, on its immigrant pages", () => {
    const activity = {
      lastIssued: "2026-01-01T00:00:00.000Z",
      lastImmigrantIssued: "2024-11-01T00:00:00.000Z",
    };
    assert.equal(
      describeInactivity({ ...input, activity }),
      "Nicosia has not issued any immigrant visas since November 2024, in State Department figures up to February 2026.",
    );
    assert.equal(
      describeInactivity({ ...input, activity, immigrant: false }),
      null,
    );
    // 12 months exactly is quiet; 11 is not
    assert.equal(
      describeInactivity({
        ...input,
        activity: {
          ...activity,
          lastImmigrantIssued: "2025-02-01T00:00:00.000Z",
        },
      }),
      "Nicosia has not issued any immigrant visas since February 2025, in State Department figures up to February 2026.",
    );
    assert.equal(
      describeInactivity({
        ...input,
        activity: {
          ...activity,
          lastImmigrantIssued: "2025-03-01T00:00:00.000Z",
        },
      }),
      null,
    );
  });

  it("describes a post that never issued one in the data", () => {
    const activity = { lastIssued: null, lastImmigrantIssued: null };
    assert.equal(
      describeInactivity({ ...input, postName: "Vancouver", activity }),
      "Vancouver did not issue any visas from January 2019 to February 2026, in State Department figures.",
    );
    assert.equal(
      summarizeInactivity({ ...input, activity }),
      "no visas issued in State Department figures",
    );
    // other visas, never an immigrant one, and the tool does not list it: a
    // nonimmigrant post, which needs no sentence
    const nonimmigrant = {
      lastIssued: "2026-01-01T00:00:00.000Z",
      lastImmigrantIssued: null,
    };
    assert.equal(
      describeInactivity({
        ...input,
        activity: nonimmigrant,
        listedInTool: false,
      }),
      null,
    );
    assert.equal(
      describeInactivity({ ...input, activity: nonimmigrant }),
      "Nicosia did not issue any immigrant visas from January 2019 to February 2026, in State Department figures.",
    );
  });
});

describe("the posts State sends elsewhere", () => {
  it("are summarized for a title and described for a description", () => {
    const moscow = IV_POSTS_ELSEWHERE.moscow;
    assert.ok(moscow !== undefined);
    assert.equal(
      summarizeIvPostElsewhere("Moscow", moscow),
      "Moscow: State lists Warsaw as the immigrant visa post for Russia",
    );
    assert.equal(
      describeIvPostElsewhere("Moscow", moscow),
      "State’s list of the embassies and consulates that process immigrant visas names Warsaw, Almaty (IR-5 only), and Tashkent (IR-5 only) for Russia, not Moscow.",
    );
    const kampala = IV_POSTS_ELSEWHERE.kampala;
    assert.ok(kampala !== undefined);
    assert.match(
      describeIvPostElsewhere("Kampala", kampala),
      /names Kampala as a regional visa hub, though\.$/,
    );
    const brunei = IV_POSTS_ELSEWHERE["bandar-seri-begawan"];
    assert.ok(brunei !== undefined);
    assert.equal(
      summarizeIvPostElsewhere("Bandar Seri Begawan", brunei),
      "Bandar Seri Begawan: State lists Kuala Lumpur and Singapore as the immigrant visa posts for Brunei",
    );
  });
});

describe("applicantCountry", () => {
  it("is the post's country without the other names in parentheses", () => {
    assert.equal(applicantCountry("Burma (Myanmar)", "rangoon"), "Burma");
    assert.equal(applicantCountry("Hungary", "budapest", "cr1ir1"), "Hungary");
    assert.equal(applicantCountry(null, "nowhere"), null);
  });
  it("is another country for the classes only its nationals get", () => {
    assert.equal(
      applicantCountry("Pakistan", "islamabad", "sq"),
      "Afghanistan",
    );
    assert.equal(
      applicantCountry("Pakistan", "islamabad", "cr1ir1"),
      "Pakistan",
    );
    assert.equal(applicantCountry("Pakistan", "islamabad"), "Pakistan");
  });
});

describe("the tool's visa classes", () => {
  it("count the family and employment immigrant visas only", () => {
    assert.equal(IV_CATEGORY_BY_CLASS.cr1ir1, "relative");
    assert.equal(IV_CATEGORY_BY_CLASS["eb-2"], "employment");
    assert.equal(IV_CATEGORY_BY_CLASS.dv, undefined);
    assert.equal(
      countToolClassIssuances([
        { visaClassSlug: "cr1ir1", issuances: 30 },
        { visaClassSlug: "f4", issuances: 12 },
        { visaClassSlug: "dv", issuances: 100 },
        { visaClassSlug: "b1b2", issuances: 1000 },
      ]),
      42,
    );
  });
});
