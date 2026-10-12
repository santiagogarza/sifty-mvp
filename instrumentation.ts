import { assertProductionEnv } from "@/lib/env/production-guards";

/**
 * Next.js server instrumentation. `register()` runs once per server
 * process (Node and Edge runtimes) before any request is served.
 */
export async function register(): Promise<void> {
  assertProductionEnv();
}
