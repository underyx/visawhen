import assert from "node:assert/strict";
import { describe, it } from "node:test";
import policyData from "../data/policy.json";
import { POLICY_ENTRIES } from "../components/policy";
import { checkPolicies, problemsWith } from "./policy";

const valid = {
  id: "an-entry",
  status: "official",
  title: "A title",
  summary: "A summary.",
  body: "The body.",
  scope: { posts: ["juba"] },
  start: "2026-05-18",
  end: null,
  sources: [{ label: "State", url: "https://example.org/" }],
  lastChecked: "2026-09-25",
};

describe("problemsWith", () => {
  it("accepts a complete entry", () => {
    assert.deepEqual(problemsWith(valid), []);
  });

  it("wants a scope, real dates and a source", () => {
    assert.deepEqual(problemsWith({ ...valid, scope: {} }), [
      "scope must name posts, countries, pages or allConsulatePages: true",
    ]);
    assert.deepEqual(problemsWith({ ...valid, start: "2026-02-30" }), [
      "start must be a date, YYYY-MM-DD",
    ]);
    assert.deepEqual(
      problemsWith({ ...valid, start: "2026-02-30", end: "2026-03-01" }),
      [
        "start must be a date, YYYY-MM-DD",
        "end must be null or a date, YYYY-MM-DD, not before start",
      ],
    );
    assert.deepEqual(problemsWith({ ...valid, end: "2026-05-01" }), [
      "end must be null or a date, YYYY-MM-DD, not before start",
    ]);
    assert.deepEqual(problemsWith({ ...valid, sources: [] }), [
      "sources must list at least one {label, url} with an http(s) URL",
    ]);
  });

  it("checks what goes with what", () => {
    assert.deepEqual(
      problemsWith({
        ...valid,
        scope: { pages: ["/nvc"], visaClasses: ["dv"] },
      }),
      [
        "scope.visaClasses must list visa class slugs, and only with posts, countries or allConsulatePages: true",
      ],
    );
    assert.deepEqual(
      problemsWith({
        ...valid,
        scope: { posts: ["juba"], exceptPosts: ["juba"] },
      }),
      [
        "scope.exceptPosts must list post slugs, and only with allConsulatePages: true",
      ],
    );
    assert.deepEqual(problemsWith({ ...valid, suspendsIssuance: true }), [
      "suspendsIssuance must be true or false, and true only with scope.countries",
    ]);
    assert.deepEqual(problemsWith({ ...valid, scope: { pages: ["/about"] } }), [
      "scope.pages may only name pages that show notices: /nvc, /uscis/i-485",
    ]);
    assert.deepEqual(
      problemsWith({
        ...valid,
        scope: {
          countries: ["Nigeria"],
          countryVisas: [
            {
              countries: ["Cuba"],
              immigrant: true,
              nonimmigrantClasses: "all",
            },
          ],
        },
      }),
      [
        'scope.countryVisas must list {countries, immigrant, nonimmigrantClasses}, each of whose countries is in scope.countries, with immigrant true or false and nonimmigrantClasses "all" or visa class slugs',
      ],
    );
  });
});

describe("data/policy.json", () => {
  it("passes the build's checks", () => {
    const scopes = POLICY_ENTRIES.map(({ scope }) => scope);
    // the names the file uses, so that only a broken entry can fail this
    checkPolicies({
      postSlugs: scopes.flatMap(({ posts = [], exceptPosts = [] }) => [
        ...posts,
        ...exceptPosts,
      ]),
      countries: scopes.flatMap(({ countries = [] }) => countries),
      visaClassSlugs: scopes.flatMap(
        ({ visaClasses = [], countryVisas = [] }) => [
          ...visaClasses,
          ...countryVisas.flatMap(({ nonimmigrantClasses }) =>
            nonimmigrantClasses === "all" ? [] : nonimmigrantClasses,
          ),
        ],
      ),
    });
    assert.equal(policyData.entries.length, POLICY_ENTRIES.length);
  });
});
