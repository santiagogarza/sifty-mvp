/**
 * This branch goes live on a plain `git switch`, with no server restart:
 * Debug Mode needs the real model call, slow enough to rename a task while it
 * is still organizing. Only under `next dev` with a gateway key, so tests and
 * builds behave as usual.
 */
export function demoLiveAi(): boolean {
  return process.env.NODE_ENV === "development" && Boolean(process.env.AI_GATEWAY_API_KEY);
}

/** The free-tier model answers in ~2s, too fast to rename a task mid-triage. */
export const DEMO_TRIAGE_MIN_MS = 6000;

/** The free-tier gateway key rejects the default model (Claude Haiku). */
export const DEMO_MODEL_ID = "gpt-4o-mini";
