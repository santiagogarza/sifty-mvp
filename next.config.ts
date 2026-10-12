import { withBotId } from "botid/next/config";
import type { NextConfig } from "next";
import { assertProductionEnv } from "./lib/env/production-guards";

// Fail the production build, not just the boot, when the env is unsafe.
assertProductionEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

// Adds the rewrites that proxy BotID's client script through our origin so
// ad blockers cannot strip it (which would make every sign-up look like a bot).
export default withBotId(nextConfig);
