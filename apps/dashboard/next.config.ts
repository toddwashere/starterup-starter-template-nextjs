import type { NextConfig } from "next";
import path from "path";
import { assertPublicMcpEnv } from "@workspace/common/env/public-mcp";
import { assertProductionAuthUrl } from "@workspace/auth/keys";
import { withSentryConfig } from "@workspace/observability/next";

assertPublicMcpEnv();
assertProductionAuthUrl();

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  transpilePackages: ["@workspace/common", "@workspace/routes", "@workspace/observability"],
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  devIndicators: {
    position: "bottom-right",
  },
};

export default withSentryConfig(nextConfig, "dashboard");
