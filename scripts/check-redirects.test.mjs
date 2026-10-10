import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  checkRedirects,
  MAX_DYNAMIC,
  servedPaths,
  sourcePattern,
} from "./check-redirects.mjs";

describe("servedPaths", () => {
  it("lists every path an export answers", () => {
    const out = mkdtempSync(join(tmpdir(), "visawhen-out-"));
    mkdirSync(join(out, "consulates", "budapest"), { recursive: true });
    writeFileSync(join(out, "index.html"), "");
    writeFileSync(join(out, "nvc.html"), "");
    writeFileSync(join(out, "consulates", "budapest", "index.html"), "");
    writeFileSync(join(out, "_headers"), "");
    assert.deepEqual([...servedPaths(out)].sort(), [
      "/",
      "/_headers",
      "/consulates/budapest",
      "/consulates/budapest/",
      "/consulates/budapest/index.html",
      "/index.html",
      "/nvc",
      "/nvc.html",
    ]);
  });
});

describe("sourcePattern", () => {
  it("matches a placeholder to one segment and a splat to anything", () => {
    assert.equal(
      sourcePattern("/consulates/:post/e3").test("/consulates/manila/e3"),
      true,
    );
    assert.equal(
      sourcePattern("/consulates/:post/e3").test("/consulates/manila/e3/x"),
      false,
    );
    assert.equal(sourcePattern("/uscis/*").test("/uscis/i-130/boston"), true);
    assert.equal(sourcePattern("/a.b").test("/axb"), false);
  });
});

describe("checkRedirects", () => {
  const served = new Set(["/", "/nvc", "/consulates/manila/eb-3", "/uscis"]);

  it("keeps the rules and counts static and dynamic ones", () => {
    const lines = [
      "# a comment",
      "",
      "/old /nvc 301",
      "/consulates/manila/e3 /consulates/manila/eb-3 301  # trailing comment",
      "/uscis/:form/* /uscis 301",
      "/x/* /uscis",
    ];
    const result = checkRedirects(lines, served);
    assert.deepEqual(result.kept, lines);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.staticRules, 2);
    assert.equal(result.dynamicRules, 2);
  });

  it("drops a rule that would hide a page, and warns of one that leads nowhere", () => {
    const result = checkRedirects(
      [
        "/consulates/manila/eb-3 /nvc",
        "/consulates/:post/eb-3 /nvc",
        "/old /gone",
      ],
      served,
    );
    assert.deepEqual(result.kept, ["/old /gone"]);
    assert.deepEqual(result.warnings, [
      'dropping the redirect "/consulates/manila/eb-3 /nvc": /consulates/manila/eb-3 is a page; remove the rule from public/_redirects',
      'dropping the redirect "/consulates/:post/eb-3 /nvc": /consulates/manila/eb-3 is a page; remove the rule from public/_redirects',
      'the redirect "/old /gone" leads to no page',
    ]);
    assert.deepEqual(
      checkRedirects(["/old /nvc?from=old"], served).warnings,
      [],
    );
  });

  it("fails a malformed, repeated or misplaced rule", () => {
    const result = checkRedirects(
      ["/old", "/a /nvc", "/a /uscis", "/b/* /nvc", "/c /nvc"],
      served,
    );
    assert.deepEqual(result.errors, [
      'line 1 ("/old") is not "from to [status]"',
      'line 3 ("/a /uscis") repeats an earlier source',
      'line 5 ("/c /nvc") has no placeholder or splat but comes after one that does (line 4), so Cloudflare counts it as dynamic; move it above line 4',
    ]);
    assert.equal(result.staticRules, 2);
    assert.equal(result.dynamicRules, 2);
  });

  it("fails on more dynamic rules than Cloudflare keeps", () => {
    const lines = Array.from(
      { length: MAX_DYNAMIC + 1 },
      (_, index) => `/d${index}/* /nvc`,
    );
    const result = checkRedirects(lines, served);
    assert.deepEqual(result.errors, [
      `${
        MAX_DYNAMIC + 1
      } rules from line 1 on count as dynamic, more than the ${MAX_DYNAMIC} Cloudflare keeps`,
    ]);
    assert.deepEqual(checkRedirects(lines.slice(1), served).errors, []);
  });
});
