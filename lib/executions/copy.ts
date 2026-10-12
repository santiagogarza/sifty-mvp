import type { ExecutionDraft, ExecutionPolicy, ExecutorKind } from "@/lib/domain/types";

/** The two answers an `approval` or `draft_review` decision takes besides a question's own options. */
export const APPROVE_OPTION = "Approve";
export const REJECT_OPTION = "Reject";

/** What `ask_first` asks on the card. */
export function approvalQuestion(action: string): string {
  return `${action}?`;
}

/** The task-sheet line for a policy ("Sifty drafts, then you approve"). */
export function policyDescription(policy: ExecutionPolicy): string {
  switch (policy) {
    case "ask_first":
      return "Sifty asks before it starts; what it produces is applied as is.";
    case "draft_then_approve":
      return "Sifty works first and shows you the draft; nothing counts until you approve.";
    case "auto":
      return "Sifty just does it. Only allowed for read-only work.";
  }
}

export function executorLabel(kind: ExecutorKind | string): string {
  switch (kind) {
    case "research":
      return "Research";
    case "ai_agent":
      return "AI agent";
    case "cursor_agent":
      return "Cursor agent";
    default:
      return kind ? `${kind.charAt(0).toUpperCase()}${kind.slice(1)}` : "Sifty";
  }
}

/** Two drafts are the same when title and body match after trimming. */
export function sameDraft(a: ExecutionDraft, b: ExecutionDraft): boolean {
  return (a.title ?? "").trim() === (b.title ?? "").trim() && a.body.trim() === b.body.trim();
}
