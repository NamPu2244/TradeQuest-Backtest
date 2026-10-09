import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.TQ_NEXT_DIST || ".next",
  outputFileTracingIncludes: {
    "/api/pine-runtime": [
      "./node_modules/pinets/dist/pinets.min.browser.js",
      "./public/pine-worker.js",
    ],
  },
  poweredByHeader: false,
  devIndicators: false,
};
export default config;
