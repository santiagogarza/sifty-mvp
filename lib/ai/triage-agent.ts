import { TRIAGE_SYSTEM_PROMPT, buildTriageUserPrompt } from "./prompts";
import { TRIAGE_PROMPT_VERSION, TriageOutput } from "./triage-schema";

/**
 * `triageTask` is the only AI entry point in MVP.
 *
 * The function deliberately has two modes:
 *
 * 1. Online: when an API key is present, it would call the real model and
 *    parse the structured output. We keep this branch as an interface
 *    contract — wiring a real provider later (AI Gateway, OpenAI, etc.)
 *    only requires implementing `callModel`.
 *
 * 2. Offline: a deterministic heuristic that produces sensible enrichment
 *    from the input. This is what makes the design feel real without keys.
 *    It is intentionally readable so the rationale shown in the UI stays
 *    accurate.
 */

export interface TriageInput {
  sourceText: string;
  sourceContext: string | null;
  recentLabels?: string[];
  preferences?: string[];
}

export interface TriageResult {
  output: TriageOutput;
  meta: {
    promptVersion: string;
    model: string;
    durationMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    costCents: number | null;
    offline: boolean;
  };
}

export async function triageTask(input: TriageInput): Promise<TriageResult> {
  const start = Date.now();
  const apiKey = process.env.AI_GATEWAY_API_KEY ?? process.env.OPENAI_API_KEY;

  if (apiKey) {
    // Reserved for real provider wiring. We still validate the response
    // through the same Zod schema so the UI never sees malformed data.
    return runOnline(input, start);
  }

  const output = heuristicTriage(input);
  return {
    output,
    meta: {
      promptVersion: TRIAGE_PROMPT_VERSION,
      model: "sifty.local.heuristic",
      durationMs: Date.now() - start,
      inputTokens: null,
      outputTokens: null,
      costCents: null,
      offline: true,
    },
  };
}

async function runOnline(_input: TriageInput, start: number): Promise<TriageResult> {
  // Placeholder. When wiring a real provider, build prompt with
  // buildTriageUserPrompt + TRIAGE_SYSTEM_PROMPT, request structured output,
  // and parse with TriageOutput.parse(...). For now we fall through to the
  // heuristic so the app behaves identically in dev.
  const output = heuristicTriage(_input);
  return {
    output,
    meta: {
      promptVersion: TRIAGE_PROMPT_VERSION,
      model: "sifty.local.heuristic",
      durationMs: Date.now() - start,
      inputTokens: null,
      outputTokens: null,
      costCents: null,
      offline: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Heuristic triage — a small expert system, not a model. Keeps the demo
// honest: every inferred field can be traced back to a rule, and the
// rationale shown in the UI explains itself.
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

  // "by friday", "on monday", "next thursday"
  const wdMatch = lower.match(
    /\b(by|on|next|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  );
  if (wdMatch) {
    const prefix = wdMatch[1]!;
    const target = WEEKDAYS.indexOf(wdMatch[2]!);
    const current = today.getDay();
    let delta = target - current;
    if (prefix === "next") {
      // "next Thursday" on Monday → this week's Thursday (3 days), not +7 more.
      if (delta <= 0) delta += 7;
    } else if (delta <= 0) {
      delta += 7;
    }
    const d = addDays(today, delta);
    return { iso: toIso(d), daysFromNow: delta };
  }

  // "in 3 days", "in 2 weeks"
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

  const suggestedLabels = inferLabels(text, input.recentLabels ?? []);

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

function inferLabels(text: string, recent: string[]): string[] {
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
