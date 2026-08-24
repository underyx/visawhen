/** @type {import('next').NextConfig} */
const CONFIG = {
  // The site is a fully static export: `next build` writes the HTML to out/,
  // which is deployed to Netlify. HTTP headers (Cache-Control) live in
  // netlify.toml, since a static export cannot set them itself.
  output: "export",
  reactStrictMode: true,
  // Stop `next dev` from dropping generated AGENTS.md/CLAUDE.md into the repo.
  agentRules: false,
  transpilePackages: ["echarts", "zrender"],
};

module.exports = CONFIG;
