import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@workspace/observability/next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  transpilePackages: [
    "@workspace/common",
    "@workspace/routes",
    "@workspace/observability",
  ],
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  devIndicators: {
    position: "bottom-right",
  },
};

export default withSentryConfig(nextConfig, "www");
