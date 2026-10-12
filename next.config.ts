import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { assertProductionEnv } from "./lib/env/production-guards";

// Fail the production build, not just the boot, when the env is unsafe.
assertProductionEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

// `withWorkflow` compiles the "use workflow" / "use step" directives in
// `lib/workflows/` and emits the queue-triggered flow route under
// `app/.well-known/workflow/`. See README → "Background jobs".
export default withWorkflow(nextConfig);
