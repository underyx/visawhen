import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchSearch,
  isNvcPage,
  pageSnippets,
  parseDate,
  parsePage,
} from "./main";

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

  it("reads through line breaks in pasted text", () => {
    const text =
      "Current case review time: As of 9-Nov-26, we are reviewing\ndocuments submitted to us on 31-Aug-26.";
    assert.deepEqual(parsePage(text), { review: ["2026-11-09", 70] });
  });
});

const NVC_PAGE =
  "https://travel.state.gov/content/travel/en/us-visas/immigrate/nvc-timeframes.html";

describe("isNvcPage", () => {
  it("knows State's page at both of its addresses", () => {
    assert.equal(isNvcPage(NVC_PAGE), true);
    assert.equal(
      isNvcPage(
        "https://travel.state.gov/en/us-visas/immigrate/nvc-timeframes.html",
      ),
      true,
    );
  });

  it("refuses other pages and other sites", () => {
    assert.equal(
      isNvcPage(
        "https://travel.state.gov/content/travel/en/us-visas/immigrate.html",
      ),
      false,
    );
    assert.equal(
      isNvcPage("https://example.com/us-visas/immigrate/nvc-timeframes.html"),
      false,
    );
    assert.equal(isNvcPage("not a link"), false);
  });
});

describe("pageSnippets", () => {
  it("keeps only what Google quotes from State's page", () => {
    assert.equal(
      pageSnippets({
        organic: [
          { link: "https://example.com/nvc", snippet: "As of 1-Jan-20 ..." },
          { link: NVC_PAGE, snippet: "As of 9-Nov-26, we are ..." },
        ],
      }),
      "As of 9-Nov-26, we are ...",
    );
    assert.equal(pageSnippets({}), "");
  });
});

describe("fetchSearch", () => {
  const snippets = {
    creation:
      "Current case creation time frame: As of 9-Nov-26, we are working on cases that were received from USCIS on 26-Oct-26. Once USCIS ...",
    review:
      "Current case review time: As of 9-Nov-26, we are reviewing documents submitted to us on 31-Aug-26. Before the ...",
    inquiry:
      "Current Public Inquiry Form response time: As of 9-Nov-26, we are responding to inquiries received on 2-Nov-26. We will ...",
  };
  const dataAsOf = (asOf: string) => ({
    creation: { [asOf]: 9 },
    review: { [asOf]: 69 },
    inquiry: { [asOf]: 10 },
  });

  it("adds the readings Google quotes when they are new", async () => {
    const data = dataAsOf("2026-10-26");
    const asked: string[] = [];
    const [changed] = await fetchSearch(data, async (name) => {
      asked.push(name);
      return snippets[name];
    });
    assert.equal(changed, true);
    assert.deepEqual(asked, ["creation", "review", "inquiry"]);
    assert.deepEqual(data, {
      creation: { "2026-10-26": 9, "2026-11-09": 14 },
      review: { "2026-10-26": 69, "2026-11-09": 70 },
      inquiry: { "2026-10-26": 10, "2026-11-09": 7 },
    });
  });

  it("stops after one search when Google has nothing new", async () => {
    const data = dataAsOf("2026-11-09");
    const asked: string[] = [];
    const [changed, reason] = await fetchSearch(data, async (name) => {
      asked.push(name);
      return snippets[name];
    });
    assert.equal(changed, false);
    assert.deepEqual(asked, ["creation"]);
    assert.match(reason, /nothing newer than 2026-11-09/);
    assert.deepEqual(data, dataAsOf("2026-11-09"));
  });

  it("adds nothing when the search fails or quotes half a sentence", async () => {
    const data = dataAsOf("2026-10-26");
    assert.deepEqual(await fetchSearch(data, async () => null), [
      false,
      "the search did not answer",
    ]);
    const [changed] = await fetchSearch(
      data,
      async () => "As of 9-Nov-26, we are working on cases that ...",
    );
    assert.equal(changed, false);
    assert.deepEqual(data, dataAsOf("2026-10-26"));
  });
});
