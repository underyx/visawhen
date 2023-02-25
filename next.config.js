const CONFIG = {
  swcMinify: true,
  reactStrictMode: true,
  transpilePackages: ["echarts", "zrender"],
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

module.exports = CONFIG;
