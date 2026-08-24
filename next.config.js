/** @type {import('next').NextConfig} */
const CONFIG = {
  // The site is a fully static export: `next build` writes the HTML to out/,
  // which is deployed to Netlify. HTTP headers (Cache-Control) live in
  // netlify.toml, since a static export cannot set them itself.
  output: "export",
  reactStrictMode: true,
  transpilePackages: ["echarts", "zrender"],
};

module.exports = CONFIG;
