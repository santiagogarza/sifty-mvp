import type { Memory, Task } from "@/lib/domain/types";
import { z } from "zod";

/**
 * Memory extraction: turn what a capture (and the user's reaction to the
 * sift) reveals into durable facts and preferences the next sift can use —
 * "prefers mornings for deep work", "Ana = accountant".
 *
 * Nothing here talks to a model or the database. `run.ts` executes the
 * stage, `propose.ts` turns proposals into decisions the user confirms.
 *
 * The bar is "will this still be true and useful in a month": a person's
 * role, a standing preference about time, effort, or tools, a recurring
 * commitment. One-off details (this Friday's deadline, a single meeting)
 * are not memories.
 */

export const MEMORY_PROMPT_VERSION = "memory.v1";
export const MEMORY_STAGE = "memory" as const;
export const MEMORY_TEMPERATURE = 0.2;

/** Most proposals one extraction may raise. */
export const MAX_MEMORY_PROPOSALS = 3;
/** Proposals below this confidence are dropped before they reach the user. */
export const MIN_MEMORY_CONFIDENCE = 0.6;

export const MemoryProposal = z.object({
  /** The memory as it would be stored: short, third person, present tense. */
  text: z.string().min(3).max(200),
  kind: z.enum(["preference", "fact", "context"]),
  /** The words in the input (or the edit) that support it. */
  evidence: z.string().min(1).max(200),
  confidence: z.number().min(0).max(1),
});
export type MemoryProposal = z.infer<typeof MemoryProposal>;

export const MemoryExtractionOutput = z.object({
  proposals: z.array(MemoryProposal).max(MAX_MEMORY_PROPOSALS),
});
export type MemoryExtractionOutput = z.infer<typeof MemoryExtractionOutput>;

/**
 * A user edit that reverses something the sift wrote. One edit is weak
 * evidence on its own; the model is asked to propose only when it reveals
 * a standing preference, and dismissals stop the same idea coming back.
 */
export interface SiftContradiction {
  field: string;
  aiValue: unknown;
  userValue: unknown;
}

export interface MemoryContext {
  task: Task;
  /** Why extraction is running. */
  trigger: "sift" | "edit";
  contradictions: SiftContradiction[];
  /** What is already remembered, so nothing is proposed twice. */
  existing: Pick<Memory, "text" | "kind">[];
  todayIso: string;
}

const STYLE = `Style:
- Be calm and concise. No emoji. No hype.
- Never invent people, roles, or habits not present in the input.
- Output must conform to the supplied JSON schema exactly.`;

export const MEMORY_SYSTEM_PROMPT = `You notice durable facts about a user of Sifty, an AI productivity app,
from a task they captured and how Sifty organized it.

${STYLE}

Propose a memory only when it will still be true and useful in a month:
- a person and their role ("Ana is the user's accountant");
- a standing preference about time, effort, tools, or communication
  ("prefers mornings for deep work", "reviews email once a day at 4pm");
- a recurring commitment or context ("runs a weekly board update on
  Mondays", "lives in Ljubljana").

Never propose one-off details: a single deadline, this week's meeting, the
content of the task itself. Never restate something already remembered.

When the input includes an edit that reversed Sifty's output, propose a
memory only if the edit reveals a standing preference ("treats invoice
tasks as low urgency"), not when it is a one-off correction. When unsure,
propose nothing — an empty list is the usual answer.

Each proposal: text in third person and present tense, kind
("preference" | "fact" | "context"), the evidence quoted from the input,
and your confidence in [0,1].`;

export function buildMemoryUserPrompt(ctx: MemoryContext): string {
  const t = ctx.task;
  return [
    `Today is ${ctx.todayIso}.`,
    ctx.existing.length
      ? `Already remembered (do not repeat):\n- ${ctx.existing.map((m) => m.text).join("\n- ")}`
      : "Nothing is remembered about this user yet.",
    "",
    "Task as captured:",
    t.sourceText,
    t.sourceContext ? `\nAdditional context:\n${t.sourceContext}` : null,
    "",
    `Sifty organized it as: "${t.title}"${t.nextAction ? ` — next action: ${t.nextAction}` : ""}; ` +
      `urgency ${t.urgency.toFixed(2)}, importance ${t.importance.toFixed(2)}, effort ${t.effort}` +
      `${t.due ? `, due ${t.due}` : ""}; status ${t.lifecycle}; delegation ${t.delegationCandidate}.`,
    ctx.contradictions.length
      ? `\nThe user then changed:\n${ctx.contradictions
          .map(
            (c) => `- ${c.field}: Sifty said ${show(c.aiValue)}, the user set ${show(c.userValue)}`,
          )
          .join("\n")}`
      : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "nothing";
  if (typeof value === "number") return value.toFixed(2);
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  return String(value);
}

// ---------------------------------------------------------------------------
// Offline variant
// ---------------------------------------------------------------------------

/** "Ana, my accountant" / "my accountant Ana" / "Ana (accountant)". */
const ROLE_AFTER_RE =
  /\b([A-Z][a-z]+)(?:,| \()\s*(?:my |our |the )?([a-z]+(?: [a-z]+)?)(?=\)|,|\.|;|\s+who\b|\s+and\b|\s*$)/gm;
const ROLE_BEFORE_RE = /\bmy ([a-z]+(?: [a-z]+)?) ([A-Z][a-z]+)\b/g;
const ROLE_WORDS = new Set([
  "accountant",
  "lawyer",
  "doctor",
  "dentist",
  "boss",
  "manager",
  "assistant",
  "landlord",
  "agent",
  "coach",
  "trainer",
  "therapist",
  "mentor",
  "cofounder",
  "co-founder",
  "partner",
  "investor",
  "advisor",
  "designer",
  "contractor",
  "plumber",
  "electrician",
  "mechanic",
  "vet",
  "sister",
  "brother",
  "mother",
  "father",
  "wife",
  "husband",
  "daughter",
  "son",
]);
const PREFERENCE_RE =
  /\b(I|we) (?:always|never|usually|prefer(?: to)?|like to|hate|tend to|only|can'?t|don'?t) [^.;\n]{4,80}/gi;

export function offlineMemoryExtraction(ctx: MemoryContext): MemoryExtractionOutput {
  const text = `${ctx.task.sourceText}\n${ctx.task.sourceContext ?? ""}`;
  const proposals: MemoryProposal[] = [];
  const seen = new Set(ctx.existing.map((m) => normalizeMemoryText(m.text)));
  const push = (p: MemoryProposal) => {
    const key = normalizeMemoryText(p.text);
    if (seen.has(key) || proposals.length >= MAX_MEMORY_PROPOSALS) return;
    seen.add(key);
    proposals.push(p);
  };

  for (const m of text.matchAll(ROLE_AFTER_RE)) {
    const [whole, name, role] = m as unknown as [string, string, string];
    if (ROLE_WORDS.has(role.toLowerCase())) {
      push({
        text: `${name} = ${role.toLowerCase()}`,
        kind: "fact",
        evidence: whole.trim(),
        confidence: 0.8,
      });
    }
  }
  for (const m of text.matchAll(ROLE_BEFORE_RE)) {
    const [whole, role, name] = m as unknown as [string, string, string];
    if (ROLE_WORDS.has(role.toLowerCase())) {
      push({
        text: `${name} = ${role.toLowerCase()}`,
        kind: "fact",
        evidence: whole,
        confidence: 0.8,
      });
    }
  }
  for (const m of text.matchAll(PREFERENCE_RE)) {
    const sentence = m[0].trim();
    push({
      text: toThirdPerson(sentence),
      kind: "preference",
      evidence: sentence,
      confidence: 0.7,
    });
  }

  // An edit that lowers urgency on a task mentioning a recurring category
  // ("invoice", "newsletter") hints at a standing preference; anything
  // else is a one-off and proposes nothing.
  for (const c of ctx.contradictions) {
    if (c.field !== "urgency" || typeof c.aiValue !== "number" || typeof c.userValue !== "number") {
      continue;
    }
    if (c.userValue >= c.aiValue) continue;
    const topic = /\b(invoice|newsletter|report|expense|timesheet|standup|inbox)s?\b/i.exec(text);
    if (!topic) continue;
    push({
      text: `Treats ${topic[1]!.toLowerCase()} tasks as low urgency`,
      kind: "preference",
      evidence: `urgency ${c.aiValue.toFixed(2)} → ${c.userValue.toFixed(2)} on "${ctx.task.title}"`,
      confidence: 0.6,
    });
  }

  return MemoryExtractionOutput.parse({ proposals });
}

function toThirdPerson(sentence: string): string {
  return sentence
    .replace(/^I /i, "Prefers: ")
    .replace(/^we /i, "Prefers: ")
    .replace(/\bmy\b/gi, "their")
    .replace(/\bour\b/gi, "their")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercased, punctuation-free, single-spaced — the dedupe key for memories. */
export function normalizeMemoryText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
