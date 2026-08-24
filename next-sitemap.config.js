/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.SITE_URL || "https://visawhen.com",
  generateRobotsTxt: true,
  changefreq: "weekly",
  // `next build` (output: "export") writes the site straight to out/, so the
  // sitemap has to be written there too instead of the default public/.
  outDir: "out",
};
