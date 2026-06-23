import { generateObject } from "ai";
import { DEFAULT_MODEL_ID, type ModelOption, estimateCostCents, getModel } from "./models";
import { TRIAGE_SYSTEM_PROMPT, buildTriageUserPrompt } from "./prompts";
import { MissingAiKeyError, resolveProvider } from "./provider";
import { TRIAGE_PROMPT_VERSION, TriageOutput } from "./triage-schema";

/**
 * `triageTask` — single AI entry point.
 *
 * Two modes:
 *
 *  1. **Online (default).** Calls the configured language model through the
 *     AI Gateway (or direct provider) and validates the response against the
 *     `TriageOutput` Zod schema. The schema is the contract the UI relies
 *     on — anything that doesn't parse is treated as a model error and
 *     surfaced to the user as a retryable failure.
 *
 *  2. **Offline (debug).** A deterministic regex heuristic. Only used when
 *     `offline: true` is passed explicitly (the API route enables this via
 *     `?offline=1`). Never a silent fallback when keys are missing — that
 *     hid misconfigurations. If no key is available and offline isn't
 *     requested, we throw `MissingAiKeyError` and the route returns 503.
 */

export interface TriageInput {
  sourceText: string;
  sourceContext: string | null;
  recentLabels?: string[];
  preferences?: string[];
  /** Sifty model id (see `lib/ai/models.ts`). Defaults to `DEFAULT_MODEL_ID`. */
  modelId?: string | null;
  /** Force the deterministic heuristic. Off by default. */
  offline?: boolean;
}

export interface TriageMeta {
  promptVersion: string;
  model: string;
  transport: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costCents: number | null;
  offline: boolean;
}

export interface TriageResult {
  output: TriageOutput;
  meta: TriageMeta;
}

const HEURISTIC_MODEL = "sifty.local.heuristic";

export async function triageTask(input: TriageInput): Promise<TriageResult> {
  const start = Date.now();

  if (input.offline) {
    const output = heuristicTriage(input);
    return {
      output,
      meta: {
        promptVersion: TRIAGE_PROMPT_VERSION,
        model: HEURISTIC_MODEL,
        transport: "offline",
        durationMs: Date.now() - start,
        inputTokens: null,
        outputTokens: null,
        costCents: null,
        offline: true,
      },
    };
  }

  const resolved = resolveProvider(input.modelId ?? DEFAULT_MODEL_ID);
  return runOnline(input, resolved.option, resolved.model, resolved.transport, start);
}

async function runOnline(
  input: TriageInput,
  option: ModelOption,
  model: Awaited<ReturnType<typeof resolveProvider>>["model"],
  transport: string,
  start: number,
): Promise<TriageResult> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const userPrompt = buildTriageUserPrompt({
    sourceText: input.sourceText,
    sourceContext: input.sourceContext,
    todayIso,
    recentLabels: input.recentLabels ?? [],
    preferences: input.preferences ?? [],
  });

  const result = await generateObject({
    model,
    schema: TriageOutput,
    schemaName: "TriageOutput",
    schemaDescription: "Sifty triage output for a single captured task.",
    system: TRIAGE_SYSTEM_PROMPT,
    prompt: userPrompt,
    temperature: 0.2,
  });

  const inputTokens = result.usage?.inputTokens ?? null;
  const outputTokens = result.usage?.outputTokens ?? null;
  const costCents = estimateCostCents({ model: option, inputTokens, outputTokens });

  return {
    output: result.object,
    meta: {
      promptVersion: TRIAGE_PROMPT_VERSION,
      model: option.gatewaySlug,
      transport,
      durationMs: Date.now() - start,
      inputTokens,
      outputTokens,
      costCents,
      offline: false,
    },
  };
}

export { MissingAiKeyError, getModel };

// ---------------------------------------------------------------------------
// Heuristic triage — debug-only fallback used when `offline: true` is set.
// Kept verbatim from the MVP so the explainability still works for screenshots
// and offline demos. After Stage 1 ships, this is *not* a product feature; it's
// a developer escape hatch.
// ---------------------------------------------------------------------------

interface Signals {
  urgentPhrase: boolean;
  importantPhrase: boolean;
  delegatablePhrase: boolean;
  aiSuitablePhrase: boolean;
  hasQuestion: boolean;
  hasDateHint: { iso: string | null; daysFromNow: number | null };
  bigEffortHint: boolean;
  quickEffortHint: boolean;
  recurringHint: boolean;
}

const URGENT_RE = /\b(today|now|asap|urgent|deadline|by\s+(end of day|eod|tonight|tomorrow))\b/i;
const IMPORTANT_RE =
  /\b(important|critical|priority|must|board|launch|customer|investor|funding)\b/i;
const DELEGATE_RE = /\b(delegate|hand off|ask\s+\w+ to|have\s+\w+\s+(do|handle))\b/i;
const AI_SUITABLE_RE =
  /\b(refactor|rename|migrate|generate|draft|summarize|translate|format|search|find|scaffold|extract|cleanup|tests?\b)/i;
const RECURRING_RE = /\b(every|weekly|daily|each\s+(day|week|month)|recurring)\b/i;
const QUICK_RE = /\b(quick|short|small|note|reply|email|text|ping)\b/i;
const DEEP_RE = /\b(spec|design|deep dive|investigate|research|architect|plan|write up)\b/i;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function detectSignals(text: string, now: Date): Signals {
  const dueHint = detectDate(text, now);
  return {
    urgentPhrase: URGENT_RE.test(text),
    importantPhrase: IMPORTANT_RE.test(text),
    delegatablePhrase: DELEGATE_RE.test(text),
    aiSuitablePhrase: AI_SUITABLE_RE.test(text),
    hasQuestion: /\?\s*$/.test(text.trim()),
    hasDateHint: dueHint,
    bigEffortHint: DEEP_RE.test(text),
    quickEffortHint: QUICK_RE.test(text),
    recurringHint: RECURRING_RE.test(text),
  };
}

function detectDate(text: string, now: Date): { iso: string | null; daysFromNow: number | null } {
  const lower = text.toLowerCase();
  const today = startOfDay(now);

  if (/\btoday\b/.test(lower)) return { iso: toIso(today), daysFromNow: 0 };
  if (/\btonight\b/.test(lower)) return { iso: toIso(today), daysFromNow: 0 };
  if (/\btomorrow\b/.test(lower)) {
    const d = addDays(today, 1);
    return { iso: toIso(d), daysFromNow: 1 };
  }

  const wdMatch = lower.match(
    /\b(by|on|next|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  );
  if (wdMatch) {
    const prefix = wdMatch[1]!;
    const target = WEEKDAYS.indexOf(wdMatch[2]!);
    const current = today.getDay();
    let delta = target - current;
    if (prefix === "next") {
      if (delta <= 0) delta += 7;
    } else if (delta <= 0) {
      delta += 7;
    }
    const d = addDays(today, delta);
    return { iso: toIso(d), daysFromNow: delta };
  }

  const inMatch = lower.match(/\bin\s+(\d+)\s+(day|days|week|weeks)\b/);
  if (inMatch) {
    const n = Number.parseInt(inMatch[1]!, 10);
    const mult = inMatch[2]!.startsWith("week") ? 7 : 1;
    const d = addDays(today, n * mult);
    return { iso: toIso(d), daysFromNow: n * mult };
  }

  return { iso: null, daysFromNow: null };
}

function heuristicTriage(input: TriageInput): TriageOutput {
  const text = `${input.sourceText}\n${input.sourceContext ?? ""}`.trim();
  const preferences = input.preferences ?? [];
  const now = new Date();
  const s = detectSignals(text, now);

  const title = makeTitle(input.sourceText);
  const nextAction = makeNextAction(input.sourceText, s);
  const description = input.sourceContext?.trim() ? input.sourceContext.trim() : null;

  let urgency = 0.4;
  if (s.urgentPhrase) urgency = 0.9;
  else if (s.hasDateHint.daysFromNow !== null) {
    const d = s.hasDateHint.daysFromNow;
    urgency = d <= 0 ? 0.95 : d <= 2 ? 0.8 : d <= 7 ? 0.6 : 0.45;
  }

  let importance = 0.45;
  if (s.importantPhrase) importance = 0.85;
  else if (s.bigEffortHint) importance = 0.65;
  else if (s.quickEffortHint) importance = 0.35;

  let effort: TriageOutput["effort"] = "small";
  if (s.bigEffortHint) effort = "deep";
  else if (s.quickEffortHint) effort = "quick";
  else if (input.sourceText.length > 180) effort = "medium";

  const delegationCandidate: TriageOutput["delegationCandidate"] = s.delegatablePhrase
    ? "person"
    : s.aiSuitablePhrase
      ? "ai"
      : "self";

  const suggestedLabels = inferLabels(text, input.recentLabels ?? [], preferences);

  const subtasks =
    effort === "deep" || effort === "medium" ? splitToSubtasks(input.sourceText) : [];

  const ruleHits = [
    s.urgentPhrase ? "matched an urgency phrase" : null,
    s.importantPhrase ? "matched an importance phrase" : null,
    s.hasDateHint.iso ? `inferred due ${s.hasDateHint.iso} from text` : null,
    s.bigEffortHint ? "matched a deep-work phrase" : null,
    s.quickEffortHint ? "matched a quick-task phrase" : null,
    s.delegatablePhrase ? "matched a delegation phrase" : null,
    s.aiSuitablePhrase ? "task pattern is AI-suitable" : null,
    ...collectPreferenceHits(text, s, preferences),
  ].filter(Boolean);

  const rationale = ruleHits.length
    ? `Heuristic triage. ${ruleHits.join("; ")}.`
    : "No strong signals — defaulting to a balanced triage.";

  let confidence = 0.65;
  if (s.urgentPhrase || s.importantPhrase || s.hasDateHint.iso) confidence += 0.1;
  if (s.hasQuestion) confidence -= 0.2;
  if (input.sourceText.split(/\s+/).filter(Boolean).length < 3) confidence -= 0.25;
  confidence = Math.max(0.2, Math.min(0.95, confidence));

  const clarifyingQuestion = confidence < 0.55 ? makeClarifyingQuestion(input.sourceText) : null;

  return TriageOutput.parse({
    title,
    description,
    nextAction,
    urgency,
    importance,
    effort,
    dueHint: s.hasDateHint.iso,
    delegationCandidate,
    suggestedLabels,
    subtasks,
    rationale,
    confidence,
    clarifyingQuestion,
  });
}

function makeTitle(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 60) return capitalize(cleaned.replace(/[.!?]+$/, ""));
  const firstSentence = cleaned.split(/(?<=[.!?])\s/)[0] ?? cleaned;
  const compact = firstSentence.length <= 80 ? firstSentence : `${firstSentence.slice(0, 77)}…`;
  return capitalize(compact.replace(/[.!?]+$/, ""));
}

function makeNextAction(text: string, s: Signals): string | null {
  const verbs = [
    "draft",
    "send",
    "schedule",
    "call",
    "ask",
    "review",
    "write",
    "outline",
    "fix",
    "ship",
    "publish",
    "open",
    "decide",
    "research",
    "list",
    "buy",
    "book",
  ];
  const cleaned = text.trim().toLowerCase();
  for (const v of verbs) {
    if (cleaned.startsWith(v)) {
      return capitalize(
        text
          .trim()
          .split(/\n/)[0]!
          .replace(/[.!?]+$/, ""),
      );
    }
  }
  if (s.hasQuestion) return null;
  if (s.aiSuitablePhrase) return `Draft a first version: ${makeTitle(text).toLowerCase()}`;
  if (s.bigEffortHint) return "Block 30 min and write a one-paragraph outline.";
  if (s.quickEffortHint) return "Send the message now.";
  return "Decide the first concrete step.";
}

function splitToSubtasks(text: string): string[] {
  const parts = text
    .split(/(?:[.;]|\sand\s|\sthen\s|\n)/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 4 && p.length < 120);
  if (parts.length < 2) return [];
  return parts.slice(0, 5).map(capitalize);
}

function collectPreferenceHits(text: string, s: Signals, preferences: string[]): string[] {
  if (!preferences.length) return [];

  const hits: string[] = [];
  const lower = text.toLowerCase();

  for (const pref of preferences) {
    const prefLower = pref.toLowerCase();

    if (
      /\b(avoid|no)\b.*\bdeep\s+work\b|\bdeep\s+work\s+after\b/.test(prefLower) &&
      s.bigEffortHint
    ) {
      hits.push("pinned preference: avoid late deep-work scheduling");
    }

    for (const name of ["cursor", "work", "personal", "writing", "admin", "errand"]) {
      if (prefLower.includes(name) && lower.includes(name)) {
        hits.push(`pinned preference aligns with ${name}`);
      }
    }
  }

  return hits;
}

function inferLabels(text: string, recent: string[], preferences: string[] = []): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();

  const candidates: Array<{ name: string; re: RegExp }> = [
    { name: "Cursor", re: /\bcursor\b/i },
    { name: "Work", re: /\b(meeting|standup|launch|customer|investor|board|deck)\b/i },
    { name: "Personal", re: /\b(home|family|partner|kids|grocery|errand|laundry)\b/i },
    { name: "Errand", re: /\b(buy|pick up|drop off|errand|store)\b/i },
    { name: "Admin", re: /\b(invoice|tax|reimburse|file|sign|paperwork)\b/i },
    { name: "Demo Prep", re: /\b(demo|walkthrough|recording)\b/i },
    { name: "Writing", re: /\b(write|draft|essay|post|blog|doc)\b/i },
  ];

  for (const c of candidates) {
    if (c.re.test(lower)) out.push(c.name);
  }
  for (const pref of preferences) {
    const prefLower = pref.toLowerCase();
    for (const c of candidates) {
      if (out.length >= 3) break;
      if (prefLower.includes(c.name.toLowerCase()) && c.re.test(lower) && !out.includes(c.name)) {
        out.push(c.name);
      }
    }
  }
  for (const r of recent) {
    if (out.length >= 3) break;
    if (lower.includes(r.toLowerCase()) && !out.includes(r)) out.push(r);
  }
  return out.slice(0, 3);
}

function makeClarifyingQuestion(text: string): string {
  if (/\?\s*$/.test(text.trim())) return "Want me to capture this as a research note for now?";
  if (text.trim().split(/\s+/).length < 3) return "What outcome would mark this as done?";
  return "Is there a deadline I should know about?";
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
