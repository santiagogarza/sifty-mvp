import type { Repos } from "@/lib/db/repos";
import { MIN_MEMORY_CONFIDENCE, type MemoryProposal, normalizeMemoryText } from "./extract";

/**
 * Where proposals go. Confirmation writes to `memories`; a dismissal is a
 * negative that stops the same proposal from being raised again. Both
 * live in the Decisions inbox (`decisions`, kind `memory_proposal`); this
 * seam exists so the extraction step can be built and tested before that
 * table lands, and so tests can capture proposals without a store.
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

/**
 * Until the Decisions inbox exists there is nowhere to ask the user, so
 * proposals are not persisted anywhere: they are logged and dropped. The
 * step still records its `ai_runs` row so the cost is visible.
 */
export const logOnlySink: MemoryProposalSink = async (_repos, userId, proposals, source) => {
  if (proposals.length) {
    console.log(
      `[memory] ${proposals.length} proposal(s) for ${userId} from ${source.trigger} on ${source.taskId}: ${proposals
        .map((p) => `"${p.text}"`)
        .join(", ")} (no decisions inbox yet; dropped)`,
    );
  }
  return { filed: 0 };
};

let _sink: MemoryProposalSink = logOnlySink;

export function setMemorySinkForTesting(sink: MemoryProposalSink | null): void {
  _sink = sink ?? logOnlySink;
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
