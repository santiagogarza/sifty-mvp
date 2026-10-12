import type { Repos } from "@/lib/db/repos";
import type { Decision, Memory, MemoryProposalPayload } from "@/lib/domain/types";
import { MIN_MEMORY_CONFIDENCE, type MemoryProposal, normalizeMemoryText } from "./extract";

/**
 * Proposals become `memory_proposal` decisions in the Decisions inbox.
 * Confirming one writes it to `memories` (`lib/decisions/actions.ts`);
 * dismissing one leaves the resolved row behind as a negative, so the
 * same idea — matched by normalized text — is never raised again. An open
 * or confirmed row blocks a duplicate the same way; an expired one does
 * not. Confirmation writes the memory under an id derived from the
 * decision, so a retry or a second tab cannot store it twice.
 *
 * The sink is a seam so tests can capture proposals without a store.
 */

export interface MemoryProposalSource {
  taskId: string;
  siftId: string;
  trigger: "sift" | "edit";
}

export type MemoryProposalSink = (
  repos: Repos,
  userId: string,
  proposals: MemoryProposal[],
  source: MemoryProposalSource,
) => Promise<{ filed: number }>;

/** How many past proposals are consulted for duplicates and negatives. */
export const PROPOSAL_HISTORY_LIMIT = 200;

export const decisionsSink: MemoryProposalSink = async (repos, userId, proposals, source) => {
  const history = await repos.decisions.listByKind(userId, "memory_proposal", {
    limit: PROPOSAL_HISTORY_LIMIT,
  });
  // Open, confirmed, or dismissed rows block the same idea. An `expired`
  // row is one the user never saw through to a verdict, so it does not.
  const known = new Set(
    history
      .filter((d) => d.status !== "expired")
      .map((d) => d.payload)
      .filter((p): p is MemoryProposalPayload => p.kind === "memory_proposal")
      .map((p) => normalizeMemoryText(p.text)),
  );
  let filed = 0;
  for (const proposal of proposals) {
    const key = normalizeMemoryText(proposal.text);
    if (known.has(key)) continue;
    known.add(key);
    const payload: MemoryProposalPayload = {
      kind: "memory_proposal",
      text: proposal.text,
      memoryKind: proposal.kind,
      rationale: proposal.evidence,
    };
    // Not attached to the task: a memory is about the user, and
    // `decisions.task_id` cascades on task delete, which would take an
    // open proposal — or a dismissal negative — down with the task.
    await repos.decisions.create(userId, {
      kind: "memory_proposal",
      taskId: null,
      payload,
      resumeToken: null,
      expiresAt: null,
    });
    filed += 1;
  }
  return { filed };
};

let _sink: MemoryProposalSink = decisionsSink;

export function setMemorySinkForTesting(sink: MemoryProposalSink | null): void {
  _sink = sink ?? decisionsSink;
}

export function proposeMemories(
  repos: Repos,
  userId: string,
  proposals: MemoryProposal[],
  source: MemoryProposalSource,
): Promise<{ filed: number }> {
  return _sink(repos, userId, proposals, source);
}

/**
 * Drop weak proposals and anything already remembered (by normalized
 * text), keeping the first of any duplicates within the batch.
 */
export function filterProposals(
  proposals: MemoryProposal[],
  existing: ReadonlyArray<{ text: string }>,
): MemoryProposal[] {
  const seen = new Set(existing.map((m) => normalizeMemoryText(m.text)));
  const out: MemoryProposal[] = [];
  for (const p of proposals) {
    if (p.confidence < MIN_MEMORY_CONFIDENCE) continue;
    const key = normalizeMemoryText(p.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...p, text: p.text.trim() });
  }
  return out;
}

/**
 * What confirming a proposal stores: pinned, so the next sift and the
 * daily plan see it as a preference.
 */
export function memoryFromProposal(decision: Decision): Omit<Memory, "createdAt"> | null {
  if (decision.payload.kind !== "memory_proposal") return null;
  return {
    id: `mem_${decision.id}`,
    text: decision.payload.text,
    kind: decision.payload.memoryKind,
    pinned: true,
  };
}
