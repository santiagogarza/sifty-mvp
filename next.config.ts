import { withBotId } from "botid/next/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

// Adds the rewrites that proxy BotID's client script through our origin so
// ad blockers cannot strip it (which would make every sign-up look like a bot).
export default withBotId(nextConfig);
