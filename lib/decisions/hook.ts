import type { DecisionAnswer } from "@/lib/domain/types";

/**
 * The contract between a decision and the workflow run suspended on it.
 * Dependency-free on purpose: the workflow bundle imports this, the
 * service and the routes import this, and neither drags the other's
 * runtime along.
 */

/** How long an unanswered decision stays open before the asking run gives up. */
export const DECISION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Hook token for the run suspended on a decision. */
export function decisionHookToken(decisionId: string): string {
  return `decision:${decisionId}`;
}

/** What the suspended workflow receives when its decision is resolved. */
export type DecisionResolutionPayload =
  | { status: "answered"; answer: DecisionAnswer }
  | { status: "dismissed" }
  | { status: "expired" };
