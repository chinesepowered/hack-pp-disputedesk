import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The agent toolkit and axios stay external so the toolkit's HTTP calls share one axios
  // instance with lib/paypal/toolkit-log.ts (which logs them for the Under the hood drawer).
  serverExternalPackages: ["@paypal/agent-toolkit", "axios", "playwright", "pdf-lib"],
  images: { unoptimized: true },
  // The vision model and the evidence pack read the seeded photos from disk on the server.
  outputFileTracingIncludes: { "/api/**/*": ["./public/seed/photos/**/*"] },
  devIndicators: false,
  // next dev writes an AGENTS.md by default. This repo keeps its own docs instead.
  agentRules: false,
};

export default nextConfig;
