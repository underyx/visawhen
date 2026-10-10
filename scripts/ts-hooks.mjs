// Module hooks that let Node load the site's TypeScript logic modules as
// they are, with Node's own type stripping and no build step: for the unit
// tests (`yarn test`, see package.json) and data/nvc/backtest.mjs.
//
// - An import without a file extension, which TypeScript's bundler resolution
//   allows ("./uscis", "lodash/deburr"), is tried with .ts and then .js
//   when nothing is found as written.
// - A JSON import ("../data/policy.json") gets the `type: "json"` attribute
//   Node requires and the bundler does not.
// - A .ts test file given to `node --test` is loaded as the ES module it is:
//   Yarn's PnP loader calls an entry point with an extension it does not
//   know CommonJS, since package.json has no "type".
//
// Only .ts modules can be loaded this way: Node strips types but does not
// compile JSX, and a type-only import in a .ts module has to say `import
// type` (ESLint enforces that for .ts files), or Node would look for an
// export that does not exist.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const NOT_FOUND = new Set([
  "ERR_MODULE_NOT_FOUND",
  "ERR_UNSUPPORTED_DIR_IMPORT",
  // Yarn PnP's own not-found error
  "QUALIFIED_PATH_RESOLUTION_FAILED",
]);

/** A .ts module is an ES module with types to strip; saying so here spares
 * Node working it out from the source, which it warns about. */
function withFormat(resolved) {
  return resolved.url.endsWith(".ts")
    ? { ...resolved, format: "module-typescript" }
    : resolved;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".json")) {
    const resolved = await nextResolve(specifier, context);
    return { ...resolved, importAttributes: { type: "json" } };
  }
  const extensionless = /\/[^./]+$/.test(specifier);
  try {
    return withFormat(await nextResolve(specifier, context));
  } catch (error) {
    if (!extensionless || !NOT_FOUND.has(error.code)) throw error;
  }
  for (const extension of [".ts", ".js"]) {
    try {
      return withFormat(await nextResolve(`${specifier}${extension}`, context));
    } catch (error) {
      if (!NOT_FOUND.has(error.code)) throw error;
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  if (url.endsWith(".ts") && loaded.format === "commonjs")
    return {
      ...loaded,
      format: "module-typescript",
      source: loaded.source ?? (await readFile(fileURLToPath(url), "utf8")),
    };
  return loaded;
}
