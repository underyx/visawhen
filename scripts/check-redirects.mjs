// Checks out/_redirects (copied from public/_redirects) after `next build`.
//
// Cloudflare Workers static assets follow a matching redirect even where a
// page exists, while Netlify serves the page. A rule that matches a page, such
// as a per-post rule for a class the post has since issued again, would hide
// that page on Cloudflare only, so it is dropped here with a warning.
//
// Cloudflare reads the file the way parseRedirects() in its workers-shared
// package does: rules without a placeholder or splat count as static only
// until the first rule with one, and every rule after that counts as dynamic.
// It keeps 2,000 static and 100 dynamic rules and silently skips the rest, so
// the build fails when a static rule follows a dynamic one or when there are
// more rules than that.
//
//     node scripts/check-redirects.mjs [out]

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const MAX_DYNAMIC = 100;
const MAX_STATIC = 2000;

const outDir = process.argv[2] ?? "out";
const redirectsPath = join(outDir, "_redirects");

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

/** Every URL path the export answers: /nvc for nvc.html, / for index.html. */
function servedPaths() {
  const paths = new Set();
  for (const file of files(outDir)) {
    const path = `/${relative(outDir, file).split(sep).join("/")}`;
    paths.add(path);
    if (path.endsWith("/index.html")) {
      const dir = path.slice(0, -"index.html".length);
      paths.add(dir);
      if (dir !== "/") paths.add(dir.slice(0, -1));
    } else if (path.endsWith(".html"))
      paths.add(path.slice(0, -".html".length));
  }
  return paths;
}

/** A rule's source as a regular expression: a placeholder matches one path
 * segment, a splat anything. */
function sourcePattern(source) {
  const pattern = source
    .split(/(:[A-Za-z]\w*|\*)/)
    .map((part) =>
      part === "*"
        ? ".*"
        : part.startsWith(":")
        ? "[^/]+"
        : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${pattern}$`);
}

if (!existsSync(redirectsPath)) {
  console.log(`${redirectsPath} does not exist; nothing to check`);
  process.exit(0);
}

const served = servedPaths();
const servedList = [...served];
const lines = readFileSync(redirectsPath, "utf-8").split("\n");
const errors = [];
const sources = new Set();
let dynamicRules = 0;
let staticRules = 0;
/** The first rule with a placeholder or splat, "line 230" */
let firstDynamic = null;
const kept = lines.filter((line, index) => {
  const tokens = line
    .replace(/\s+#.*$/, "")
    .trim()
    .split(/\s+/);
  const [source, target] = tokens;
  if (source === "" || source.startsWith("#")) return true;
  const where = `line ${index + 1} ("${line.trim()}")`;
  if (tokens.length < 2 || tokens.length > 3) {
    errors.push(`${where} is not "from to [status]"`);
    return true;
  }
  const pattern = sourcePattern(source);
  const shadowed = servedList.find((path) => pattern.test(path));
  if (shadowed !== undefined) {
    console.log(
      `::warning::dropping the redirect "${line.trim()}": ${shadowed} is a page; remove the rule from public/_redirects`,
    );
    return false;
  }
  // Cloudflare ignores every rule for a source but the first.
  if (sources.has(source)) errors.push(`${where} repeats an earlier source`);
  sources.add(source);
  if (/[:*]/.test(source)) {
    firstDynamic ??= `line ${index + 1}`;
    dynamicRules++;
  } else if (firstDynamic !== null) {
    errors.push(
      `${where} has no placeholder or splat but comes after one that does (${firstDynamic}), so Cloudflare counts it as dynamic; move it above ${firstDynamic}`,
    );
    dynamicRules++;
  } else {
    staticRules++;
    if (!served.has(target.split(/[?#]/)[0]))
      console.log(`::warning::the redirect "${line.trim()}" leads to no page`);
  }
  return true;
});

if (kept.length !== lines.length) writeFileSync(redirectsPath, kept.join("\n"));
console.log(
  `${redirectsPath}: ${staticRules} static rules (limit ${MAX_STATIC}), then ${dynamicRules} with placeholders or splats (limit ${MAX_DYNAMIC})`,
);
if (dynamicRules > MAX_DYNAMIC)
  errors.push(
    `${dynamicRules} rules from ${firstDynamic} on count as dynamic, more than the ${MAX_DYNAMIC} Cloudflare keeps`,
  );
if (staticRules > MAX_STATIC)
  errors.push(
    `${staticRules} static rules, more than the ${MAX_STATIC} Cloudflare keeps`,
  );
for (const error of errors) console.log(`::error::${redirectsPath}: ${error}`);
if (errors.length > 0) process.exit(1);
