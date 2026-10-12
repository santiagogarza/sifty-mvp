import type { Decision, DecisionKind } from "@/lib/domain/types";
import { APPROVE_OPTION, REJECT_OPTION } from "@/lib/executions/copy";
import type { DecisionLinkAction } from "./links";

/** The one answer a memory proposal takes; stored on the decision as its option. */
export const REMEMBER_OPTION = "Remember";

/** Open decisions by kind, from a list `listOpen` returned. */
export function countByKind(decisions: readonly Decision[]): Record<DecisionKind, number> {
  const counts: Record<DecisionKind, number> = {
    clarifying_question: 0,
    memory_proposal: 0,
    approval: 0,
    draft_review: 0,
  };
  for (const d of decisions) counts[d.kind] += 1;
  return counts;
}

export const EMPTY_WAITING_LINE =
  "Questions Sifty could not answer on its own, things it noticed, and work waiting for your go-ahead, in one place.";

/**
 * Header line for the inbox: what is waiting, by kind, in one sentence.
 * Approvals (`approval` + `draft_review`) come first — they are the items
 * with something already done behind them.
 */
export function describeWaiting(counts: Partial<Record<DecisionKind, number>>): string {
  const questions = counts.clarifying_question ?? 0;
  const proposals = counts.memory_proposal ?? 0;
  const approvals = (counts.approval ?? 0) + (counts.draft_review ?? 0);

  const parts: string[] = [];
  if (approvals) {
    parts.push(
      approvals === 1
        ? "one piece of work waiting for your go-ahead"
        : `${approvals} pieces of work waiting for your go-ahead`,
    );
  }
  if (questions) {
    parts.push(
      questions === 1
        ? "one question Sifty could not answer on its own"
        : `${questions} questions Sifty could not answer on its own`,
    );
  }
  if (proposals) {
    parts.push(
      proposals === 1
        ? "one thing Sifty noticed about you"
        : `${proposals} things Sifty noticed about you`,
    );
  }
  if (parts.length === 0) return EMPTY_WAITING_LINE;

  const list = joinNatural(parts);
  const sentence = `${list.charAt(0).toUpperCase()}${list.slice(1)}.`;
  if (approvals && !questions && !proposals) return `${sentence} Approve, edit, or reject.`;
  if (questions && !approvals && !proposals) return `${sentence} One tap each, or let it decide.`;
  if (proposals && !approvals && !questions) return `${sentence} Remember it, or not.`;
  return `${sentence} One tap each.`;
}

function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]}, and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * The one-button page's wording depends on what the tap does: an
 * approval or a draft review is approved / rejected, a question is
 * answered / left to Sifty, a memory proposal is remembered / dropped.
 */
export function confirmCopy(
  link: DecisionLinkAction,
  kind: DecisionKind | null,
): { label: string; question: string } {
  const execution = kind === "approval" || kind === "draft_review";
  if (link.action === "answer") {
    if (execution && link.option === APPROVE_OPTION) {
      return {
        label: "Approve",
        question:
          kind === "draft_review"
            ? "Approve this draft as Sifty wrote it? To edit it first, open it in Sifty."
            : "Let Sifty go ahead with this?",
      };
    }
    if (execution && link.option === REJECT_OPTION) {
      return { label: "Reject", question: "Stop this and keep nothing Sifty prepared?" };
    }
    if (kind === "memory_proposal") {
      return { label: "Remember", question: "Keep this as something Sifty knows about you?" };
    }
    return { label: `Answer “${link.option}”`, question: "Send this answer to Sifty?" };
  }
  if (execution) {
    return { label: "Reject", question: "Stop this and keep nothing Sifty prepared?" };
  }
  if (kind === "memory_proposal") {
    return { label: "Not this", question: "Drop this suggestion? Sifty won’t raise it again." };
  }
  return {
    label: "Let Sifty decide",
    question: "Skip this question and keep Sifty’s own read of the task?",
  };
}
