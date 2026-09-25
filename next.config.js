const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const path = require("node:path");

// The files under data/ that the pages' scripts import (components/policy.ts
// imports data/policy.json). The rest of data/ reaches the pages only through
// getStaticProps, as page HTML and /_next/data JSON, never through their
// scripts; ClientDataCheck below fails the build otherwise.
const CLIENT_DATA = ["data/policy.json"];

/**
 * The build id, from the code alone: a hash of the git index entries (path and
 * content hash) of every tracked file outside data/, and of CLIENT_DATA.
 *
 * Next.js puts the build id in every page and in the /_next/static/<id>/ and
 * /_next/data/<id>/ paths. Its default, a random id per build, changed all
 * ~16,000 files on every deploy, so a data update uploaded them all; with this
 * id it changes only the pages whose data changed.
 *
 * This cannot break client-side navigation from a page loaded before a deploy.
 * The id changes whenever anything the scripts are built from changes: the
 * code, the config files, package.json, yarn.lock and the committed packages,
 * and CLIENT_DATA. So while the id stays the same, the scripts stay the same,
 * and an old page's scripts reading the new deploy's /_next/data/<id>/*.json
 * do exactly what the new page's scripts do: they show the newer data. When
 * the id changes, an old page asks for /_next/data/<old id>/..., which the new
 * deploy does not have, and Next.js falls back to a full page load, as it did
 * after every deploy before. /_next/static/<id>/_buildManifest.js, cached as
 * immutable, likewise changes only with the scripts, and so with the id.
 *
 * Without git (a build from a tarball), Next.js makes up a random id.
 */
function buildId() {
  let index;
  try {
    const lsFiles = (...pathspecs) =>
      execFileSync("git", ["ls-files", "--stage", "--", ...pathspecs], {
        cwd: __dirname,
        encoding: "utf8",
      });
    index = lsFiles(".", ":(exclude)data/") + lsFiles(...CLIENT_DATA);
  } catch {
    return null;
  }
  // Next.js keeps "ad" out of the ids it makes up, since ad blockers may block
  // such URLs; so does this.
  let hash = createHash("sha256").update(index).digest("hex");
  while (/ad/.test(hash.slice(0, 20)))
    hash = createHash("sha256").update(hash).digest("hex");
  return hash.slice(0, 20);
}

/** Fails the build when the pages' scripts import a file under data/ that is
 * not in CLIENT_DATA: the build id would not change with it. */
class ClientDataCheck {
  apply(compiler) {
    const dataDir = path.join(__dirname, "data") + path.sep;
    const allowed = new Set(
      CLIENT_DATA.map((file) => path.join(__dirname, file)),
    );
    compiler.hooks.thisCompilation.tap("ClientDataCheck", (compilation) => {
      compilation.hooks.finishModules.tap("ClientDataCheck", (modules) => {
        for (const webpackModule of modules) {
          const file = webpackModule.resource?.split("?")[0];
          if (!file?.startsWith(dataDir) || allowed.has(file)) continue;
          const name = path.relative(__dirname, file);
          const message =
            `${name} is imported by the pages' scripts; add it to CLIENT_DATA` +
            " in next.config.js so that the build id changes with it";
          compilation.errors.push(new compiler.webpack.WebpackError(message));
        }
      });
    });
  }
}

/** @type {import('next').NextConfig} */
const CONFIG = {
  // The site is a fully static export: `next build` writes it to out/, which
  // .github/workflows/deploy.yml uploads to Netlify and to Cloudflare Workers
  // (visawhen.com is proxied through Cloudflare to Netlify; see deploy.yml).
  // A static export cannot set HTTP headers itself: the Cache-Control headers
  // are in public/_headers for Cloudflare Workers and written into out/_headers
  // by deploy.yml for Netlify.
  output: "export",
  reactStrictMode: true,
  // Stop `next dev` from dropping generated AGENTS.md/CLAUDE.md into the repo.
  agentRules: false,
  generateBuildId: buildId,
  webpack(config, { isServer }) {
    if (!isServer) config.plugins.push(new ClientDataCheck());
    return config;
  },
};

module.exports = CONFIG;
