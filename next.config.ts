import type { NextConfig } from "next";
import { assertProductionEnv } from "./lib/env/production-guards";

// Fail the production build, not just the boot, when the env is unsafe.
assertProductionEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
