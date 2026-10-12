import { detectContradictions } from "@/lib/ai/memory/contradictions";
import {
  MAX_MEMORY_PROPOSALS,
  MEMORY_SYSTEM_PROMPT,
  type MemoryContext,
  MemoryExtractionOutput,
  buildMemoryUserPrompt,
  normalizeMemoryText,
  offlineMemoryExtraction,
} from "@/lib/ai/memory/extract";
import { looksMemoryWorthy } from "@/lib/ai/memory/prefilter";
import { filterProposals } from "@/lib/ai/memory/propose";
import type { Task } from "@/lib/domain/types";
import { describe, expect, it } from "vitest";

let seq = 0;
function task(overrides: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `task_${seq}`,
    sourceText: "Do the thing",
    sourceContext: null,
    title: "Do the thing",
    description: null,
    nextAction: null,
    lifecycle: "inbox",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.4,
    importance: 0.4,
    priorityBucket: "drop",
    effort: "small",
    due: null,
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.8,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    siftId: "sift_1",
    siftStage: null,
    plan: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function ctx(t: Task, extra: Partial<MemoryContext> = {}): MemoryContext {
  return {
    task: t,
    trigger: "sift",
    contradictions: [],
    existing: [],
    todayIso: "2026-10-12",
    ...extra,
  };
}

describe("offline memory extraction", () => {
  it("proposes a person's role from 'Name, my role' and 'my role Name'", () => {
    const out = offlineMemoryExtraction(
      ctx(task({ sourceText: "Send the Q3 numbers to Ana, my accountant, before Friday" })),
    );
    expect(out.proposals).toEqual([
      {
        text: "Ana = accountant",
        kind: "fact",
        evidence: "Ana, my accountant",
        confidence: 0.8,
      },
    ]);
    const before = offlineMemoryExtraction(
      ctx(task({ sourceText: "Ask my lawyer Maja about the lease renewal" })),
    );
    expect(before.proposals[0]).toMatchObject({ text: "Maja = lawyer", kind: "fact" });
  });

  it("turns first-person habits into third-person preferences", () => {
    const out = offlineMemoryExtraction(
      ctx(
        task({
          sourceText: "Block Thursday morning for the deck. I always do deep work before noon.",
        }),
      ),
    );
    expect(out.proposals).toEqual([
      {
        text: "Prefers: always do deep work before noon",
        kind: "preference",
        evidence: "I always do deep work before noon",
        confidence: 0.7,
      },
    ]);
  });

  it("never repeats something already remembered, and caps the batch", () => {
    const t = task({
      sourceText:
        "Call Ana, my accountant. Ping Jure, my lawyer. Email Tina, my dentist. I never take calls after 5pm.",
    });
    const out = offlineMemoryExtraction(
      ctx(t, { existing: [{ text: "ana = accountant", kind: "fact" }] }),
    );
    expect(out.proposals.map((p) => p.text)).not.toContain("Ana = accountant");
    expect(out.proposals.length).toBeLessThanOrEqual(MAX_MEMORY_PROPOSALS);
    expect(() => MemoryExtractionOutput.parse(out)).not.toThrow();
  });

  it("a lowered urgency on a recurring category becomes a tentative preference", () => {
    const t = task({
      sourceText: "Pay the October invoice from the printer",
      title: "Pay printer invoice",
    });
    const out = offlineMemoryExtraction(
      ctx(t, {
        trigger: "edit",
        contradictions: [{ field: "urgency", aiValue: 0.8, userValue: 0.3 }],
      }),
    );
    expect(out.proposals).toEqual([
      {
        text: "Treats invoice tasks as low urgency",
        kind: "preference",
        evidence: 'urgency 0.80 → 0.30 on "Pay printer invoice"',
        confidence: 0.6,
      },
    ]);
    // Raising urgency, or a one-off task, proposes nothing.
    expect(
      offlineMemoryExtraction(
        ctx(t, {
          trigger: "edit",
          contradictions: [{ field: "urgency", aiValue: 0.3, userValue: 0.9 }],
        }),
      ).proposals,
    ).toEqual([]);
    expect(
      offlineMemoryExtraction(
        ctx(task({ sourceText: "Fix the wobbly chair" }), {
          trigger: "edit",
          contradictions: [{ field: "urgency", aiValue: 0.8, userValue: 0.3 }],
        }),
      ).proposals,
    ).toEqual([]);
  });

  it("mundane captures propose nothing", () => {
    for (const text of ["Buy milk", "Fix the login bug", "Call the bank tomorrow"]) {
      expect(offlineMemoryExtraction(ctx(task({ sourceText: text }))).proposals).toEqual([]);
    }
  });
});

describe("prefilter", () => {
  it("lets through captures that tend to carry memories", () => {
    for (const text of [
      "Send the numbers to Ana, my accountant",
      "I always do deep work in the mornings",
      "Weekly board update every Monday",
      "Ask my landlord about the heating",
      "No meetings before noon from now on",
    ]) {
      expect(looksMemoryWorthy(text), text).toBe(true);
    }
  });

  it("stops the mundane ones before any model call", () => {
    for (const text of [
      "Buy milk",
      "Fix the login bug",
      "Renew passport",
      "call back",
      "Dentist",
    ]) {
      expect(looksMemoryWorthy(text), text).toBe(false);
    }
  });
});

describe("detectContradictions", () => {
  const sifted = task({
    urgency: 0.8,
    importance: 0.7,
    effort: "deep",
    due: "2026-10-15",
    labelIds: ["l1"],
  });

  it("reports first-time reversals of the sift's signal fields only", () => {
    const found = detectContradictions(
      sifted,
      { urgency: 0.3, effort: "deep", title: "Renamed", due: null },
      ["urgency", "effort", "title", "due"],
    );
    expect(found).toEqual([
      { field: "urgency", aiValue: 0.8, userValue: 0.3 },
      { field: "due", aiValue: "2026-10-15", userValue: null },
    ]);
  });

  it("ignores tasks that are not sifted, fields already edited, and unmarked patches", () => {
    expect(
      detectContradictions(task({ aiStatus: "running" }), { urgency: 0.1 }, ["urgency"]),
    ).toEqual([]);
    expect(detectContradictions(task({ siftId: null }), { urgency: 0.1 }, ["urgency"])).toEqual([]);
    expect(
      detectContradictions({ ...sifted, editedFields: ["urgency"] }, { urgency: 0.1 }, ["urgency"]),
    ).toEqual([]);
    expect(detectContradictions(sifted, { urgency: 0.1 }, undefined)).toEqual([]);
    expect(detectContradictions(sifted, { urgency: 0.1 }, [])).toEqual([]);
    // Same labels in the same order is not a contradiction.
    expect(detectContradictions(sifted, { labelIds: ["l1"] }, ["labelIds"])).toEqual([]);
  });
});

describe("filterProposals and normalization", () => {
  it("drops weak and duplicate proposals and trims text", () => {
    const kept = filterProposals(
      [
        { text: "  Ana = accountant ", kind: "fact", evidence: "e", confidence: 0.9 },
        { text: "ana = accountant", kind: "fact", evidence: "e", confidence: 0.9 },
        { text: "Prefers mornings", kind: "preference", evidence: "e", confidence: 0.4 },
        { text: "Lives in Ljubljana", kind: "context", evidence: "e", confidence: 0.7 },
      ],
      [{ text: "Lives in Ljubljana." }],
    );
    expect(kept.map((p) => p.text)).toEqual(["Ana = accountant"]);
    expect(normalizeMemoryText("Ana — the Accountant!")).toBe("ana the accountant");
  });
});

describe("memory prompt", () => {
  it("shows the capture, the sift's reading, existing memories, and the user's changes", () => {
    const t = task({
      sourceText: "Send the Q3 numbers to Ana, my accountant",
      title: "Send Q3 numbers to Ana",
      nextAction: "Export the Q3 P&L",
      urgency: 0.8,
      due: "2026-10-15",
    });
    const user = buildMemoryUserPrompt(
      ctx(t, {
        trigger: "edit",
        existing: [{ text: "Prefers mornings for deep work", kind: "preference" }],
        contradictions: [
          { field: "urgency", aiValue: 0.8, userValue: 0.3 },
          { field: "labelIds", aiValue: ["l1"], userValue: [] },
        ],
      }),
    );
    expect(user).toContain("Already remembered (do not repeat):\n- Prefers mornings for deep work");
    expect(user).toContain("Send the Q3 numbers to Ana, my accountant");
    expect(user).toContain(
      'Sifty organized it as: "Send Q3 numbers to Ana" — next action: Export the Q3 P&L; urgency 0.80',
    );
    expect(user).toContain("- urgency: Sifty said 0.80, the user set 0.30");
    expect(user).toContain("- labelIds: Sifty said l1, the user set none");
    expect(MEMORY_SYSTEM_PROMPT).toContain("an empty list is the usual answer");
  });
});
