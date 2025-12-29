const CONFIG = {
  output: "export",
  swcMinify: true,
  reactStrictMode: true,
  transpilePackages: ["echarts", "zrender"],
  // Note: headers() is not supported with output: 'export'
  // Configure cache headers in Cloudflare Pages instead
};

module.exports = CONFIG;
