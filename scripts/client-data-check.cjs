// A Turbopack loader that fails the build when the pages' scripts import a
// file under data/ that next.config.js's CLIENT_DATA does not list: the
// build id would not change with it. next.config.js's turbopack rule runs it
// only for JSON files under data/ in the browser build, and not for
// CLIENT_DATA.
const path = require("node:path");

module.exports = function clientDataCheck() {
  const name = path.relative(path.join(__dirname, ".."), this.resourcePath);
  throw new Error(
    `${name} is imported by the pages' scripts; add it to CLIENT_DATA in next.config.js so that the build id changes with it`,
  );
};
