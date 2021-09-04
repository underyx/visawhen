const withTM = require("next-transpile-modules")(["echarts", "zrender"]);

const CONFIG = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600",
          },
        ],
      },
      {
        source: "/nvc",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=600",
          },
        ],
      },
    ];
  },
};

module.exports = withTM(CONFIG);
