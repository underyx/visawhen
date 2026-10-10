import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasEnded,
  hasStarted,
  isAboutPage,
  issuanceSuspensionFor,
  namesPage,
  overridesUpdate,
  type PolicyEntry,
  policiesFor,
  scheduleOverrideFor,
} from "./policy";

function entry(fields: Partial<PolicyEntry> & { id: string }): PolicyEntry {
  return {
    status: "official",
    title: fields.id,
    summary: "A summary.",
    body: "The body.",
    scope: {},
    start: "2026-05-18",
    end: null,
    sources: [{ label: "State", url: "https://example.org/" }],
    lastChecked: "2026-09-25",
    ...fields,
  };
}

const juba = entry({
  id: "juba-pause",
  scope: { posts: ["juba"] },
  overridesSchedule: true,
  start: "2026-05-18",
  end: null,
});
const worldwide = entry({
  id: "worldwide-pause",
  scope: { allConsulatePages: true, exceptPosts: ["budapest"] },
  overridesSchedule: true,
  expanded: true,
  start: "2026-06-01",
  end: "2026-07-01",
});
const nigerians = entry({
  id: "proclamation",
  scope: {
    countries: ["Nigeria", "Cuba"],
    countryVisas: [
      {
        countries: ["Nigeria"],
        immigrant: true,
        nonimmigrantClasses: ["b1b2"],
      },
    ],
    pages: ["/nvc"],
  },
  suspendsIssuance: true,
  start: "2026-06-09",
  end: null,
});
const dvOnly = entry({
  id: "dv",
  scope: { allConsulatePages: true, visaClasses: ["dv"] },
});
const nvcOnly = entry({
  id: "nvc-fees",
  scope: { pages: ["/nvc"], immigrantVisasOnly: true, allConsulatePages: true },
});
const entries = [juba, worldwide, nigerians, dvOnly, nvcOnly];

describe("hasStarted and hasEnded", () => {
  it("go by the day the entry was last checked while prerendering", () => {
    const announced = entry({
      id: "later",
      start: "2026-10-01",
      lastChecked: "2026-09-25",
    });
    assert.equal(hasStarted(announced, null), false);
    assert.equal(hasStarted(announced, "2026-09-30"), false);
    assert.equal(hasStarted(announced, "2026-10-01"), true);
    assert.equal(hasStarted(juba, null), true);
  });
  it("end on the entry's end day", () => {
    assert.equal(hasEnded(juba, "2027-01-01"), false);
    assert.equal(hasEnded(worldwide, null), true);
    const ending = entry({
      id: "ending",
      end: "2026-10-01",
      lastChecked: "2026-09-25",
    });
    assert.equal(hasEnded(ending, null), false);
    assert.equal(hasEnded(ending, "2026-09-30"), false);
    assert.equal(hasEnded(ending, "2026-10-01"), true);
  });
});

describe("overridesUpdate", () => {
  it("ignores a tool update taken while the entry applied, even after it ended", () => {
    assert.equal(overridesUpdate(worldwide, "2026-06-15", "2026-08-01"), true);
    assert.equal(overridesUpdate(worldwide, "2026-07-15", "2026-08-01"), false);
    assert.equal(overridesUpdate(juba, "2026-09-23", "2026-10-01"), true);
  });
});

describe("policiesFor", () => {
  const page = (
    postSlug: string,
    country: string | null,
    visaClassSlug?: string,
    nonimmigrant?: boolean,
  ) =>
    policiesFor(
      { consulate: { postSlug, country, visaClassSlug, nonimmigrant } },
      entries,
    ).map(({ id }) => id);

  it("finds the entries that name a post, or cover every post", () => {
    assert.deepEqual(page("juba", "South Sudan"), [
      "juba-pause",
      "worldwide-pause",
      "nvc-fees",
    ]);
    assert.deepEqual(page("budapest", "Hungary"), ["nvc-fees"]);
  });

  it("finds an entry about the page's country, for the visas it covers there", () => {
    assert.deepEqual(page("lagos", "Nigeria"), [
      "worldwide-pause",
      "proclamation",
      "nvc-fees",
    ]);
    assert.deepEqual(page("lagos", "Nigeria", "cr1ir1"), [
      "worldwide-pause",
      "proclamation",
      "nvc-fees",
    ]);
    assert.deepEqual(page("lagos", "Nigeria", "b1b2", true), [
      "worldwide-pause",
      "proclamation",
      "nvc-fees",
    ]);
    assert.deepEqual(page("lagos", "Nigeria", "h1b", true), [
      "worldwide-pause",
      "nvc-fees",
    ]);
    // a country in no group of countryVisas is covered for every class
    assert.deepEqual(page("havana", "Cuba", "h1b", true), [
      "worldwide-pause",
      "proclamation",
      "nvc-fees",
    ]);
  });

  it("shows a visa class entry only on that class's pages", () => {
    assert.deepEqual(page("lagos", "Nigeria", "dv"), [
      "worldwide-pause",
      "proclamation",
      "dv",
      "nvc-fees",
    ]);
    assert.equal(page("lagos", "Nigeria").includes("dv"), false);
  });

  it("leaves out entries about immigrant visas only without `immigrant`", () => {
    const ids = policiesFor(
      {
        consulate: {
          postSlug: "lagos",
          country: null,
          visaClassSlug: "h1b",
          nonimmigrant: true,
        },
        immigrant: false,
      },
      entries,
    ).map(({ id }) => id);
    assert.deepEqual(ids, ["worldwide-pause"]);
  });

  it("finds the entries for another page by its path", () => {
    assert.deepEqual(
      policiesFor({ page: "/nvc" }, entries).map(({ id }) => id),
      ["proclamation", "nvc-fees"],
    );
    assert.deepEqual(policiesFor({ page: "/uscis/i-485" }, entries), []);
  });
});

describe("isAboutPage and namesPage", () => {
  it("expand an entry that names the page, or is expanded, but not on a nonimmigrant class's page", () => {
    const lagos = { postSlug: "lagos", country: "Nigeria" };
    assert.equal(namesPage(nigerians, lagos), true);
    assert.equal(namesPage(worldwide, lagos), false);
    assert.equal(isAboutPage(worldwide, lagos), true);
    assert.equal(
      isAboutPage(worldwide, {
        ...lagos,
        visaClassSlug: "h1b",
        nonimmigrant: true,
      }),
      false,
    );
    assert.equal(isAboutPage(nvcOnly, lagos), false);
    assert.equal(namesPage(dvOnly, { ...lagos, visaClassSlug: "dv" }), true);
  });
});

describe("issuanceSuspensionFor", () => {
  it("finds the entry that stops visas for the country's nationals", () => {
    assert.equal(issuanceSuspensionFor("Nigeria", entries)?.id, "proclamation");
    assert.equal(issuanceSuspensionFor("Cuba", entries)?.id, "proclamation");
    assert.equal(issuanceSuspensionFor("Hungary", entries), null);
    assert.equal(issuanceSuspensionFor(null, entries), null);
  });
  it("leaves out an entry that covers no immigrant visas for the country", () => {
    const nonimmigrantOnly = entry({
      ...nigerians,
      scope: {
        ...nigerians.scope,
        countryVisas: [
          {
            countries: ["Nigeria"],
            immigrant: false,
            nonimmigrantClasses: "all",
          },
        ],
      },
    });
    assert.equal(issuanceSuspensionFor("Nigeria", [nonimmigrantOnly]), null);
    assert.equal(
      issuanceSuspensionFor("Cuba", [nonimmigrantOnly])?.id,
      "proclamation",
    );
  });
  it("leaves out an entry that has ended by the time it was last checked", () => {
    const ended = entry({ ...nigerians, end: "2026-09-01" });
    assert.equal(issuanceSuspensionFor("Nigeria", [ended]), null);
  });
});

describe("scheduleOverrideFor", () => {
  it("finds the entry that makes the tool's month no queue at a post", () => {
    assert.equal(
      scheduleOverrideFor("juba", "2026-09-23", null, entries)?.id,
      "juba-pause",
    );
    assert.equal(
      scheduleOverrideFor("nairobi", "2026-09-23", null, entries),
      null,
    );
    assert.equal(
      scheduleOverrideFor("budapest", "2026-06-15", null, entries),
      null,
    );
  });
  it("keeps overriding a tool update taken while a pause lasted", () => {
    assert.equal(
      scheduleOverrideFor("nairobi", "2026-06-15", null, entries)?.id,
      "worldwide-pause",
    );
    assert.equal(
      scheduleOverrideFor("nairobi", "2026-07-15", null, entries),
      null,
    );
  });
  it("picks the entry that lasts longest when several apply", () => {
    assert.equal(
      scheduleOverrideFor("juba", "2026-06-15", null, entries)?.id,
      "juba-pause",
    );
  });
  it("counts an entry from its start, by today on the client", () => {
    const later = entry({
      ...juba,
      start: "2026-10-01",
      lastChecked: "2026-09-25",
    });
    assert.equal(
      scheduleOverrideFor("juba", "2026-09-23", null, [later]),
      null,
    );
    assert.equal(
      scheduleOverrideFor("juba", "2026-09-23", "2026-10-02", [later])?.id,
      "juba-pause",
    );
  });
});
