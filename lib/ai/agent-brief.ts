import type { Task } from "@/lib/domain/types";
import { generateObject } from "ai";
import { z } from "zod";
import { DEFAULT_MODEL_ID, estimateCostCents } from "./models";
import { resolveProvider } from "./provider";
import type { TriageMeta } from "./triage-agent";

/**
 * "Prepare for agent" — turns a task into a clean, reviewable handoff brief
 * (markdown) for an AI agent or a person. The MVP never auto-launches an
 * agent; the brief is the execution interface the user copies out.
 *
 * Mirrors the triage agent's contract: structured output validated by Zod,
 * an offline deterministic fallback for keyless dev, and a `TriageMeta`
 * record for `ai_runs`.
 */

export const BRIEF_PROMPT_VERSION = "brief.v1";

const OFFLINE_MODEL = "sifty.local.brief-template";

export const AgentBriefOutput = z.object({
  objective: z.string().min(1).max(300),
  /** Bullet points of context the executor needs. */
  context: z.array(z.string().min(1).max(300)).max(6),
  /** Ordered, concrete steps. */
  steps: z.array(z.string().min(1).max(300)).min(2).max(8),
  successCriteria: z.array(z.string().min(1).max(300)).min(1).max(5),
  /** Things the executor should ask before starting, if any. */
  openQuestions: z.array(z.string().min(1).max(200)).max(3),
});
export type AgentBriefOutput = z.infer<typeof AgentBriefOutput>;

export const BRIEF_SYSTEM_PROMPT = `You prepare handoff briefs for tasks in an AI productivity app called Sifty.

The brief will be pasted into an AI coding agent or sent to a person, so it
must stand alone: no references to "the app", no assumed context beyond what
you are given.

Style:
- Calm, concise, concrete. Verbs first. No emoji, no hype.
- Steps must be actionable and verifiable, not vague ("investigate X and
  write down the answer to Y", never "look into things").
- Never invent facts, dates, people, or constraints not present in the input.
- If key information is missing, put what you'd need into openQuestions
  rather than guessing.

Output must conform to the supplied JSON schema exactly.`;

export function buildBriefUserPrompt(args: {
  task: Task;
  labelNames: string[];
  preferences: string[];
  todayIso: string;
}): string {
  const { task } = args;
  return [
    `Today is ${args.todayIso}.`,
    args.preferences.length ? `User preferences:\n- ${args.preferences.join("\n- ")}` : null,
    "",
    "Prepare a handoff brief for this task:",
    `Title: ${task.title}`,
    `Original capture: ${task.sourceText}`,
    task.sourceContext ? `Context: ${task.sourceContext}` : null,
    task.description && task.description !== task.sourceContext
      ? `Description: ${task.description}`
      : null,
    task.nextAction ? `Planned next action: ${task.nextAction}` : null,
    task.due ? `Due: ${task.due}` : null,
    args.labelNames.length ? `Labels: ${args.labelNames.join(", ")}` : null,
    task.subtasks.length
      ? `Existing subtasks:\n- ${task.subtasks.map((s) => s.title).join("\n- ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function briefToMarkdown(brief: AgentBriefOutput): string {
  const lines: string[] = ["## Objective", brief.objective];
  if (brief.context.length) {
    lines.push("", "## Context", ...brief.context.map((c) => `- ${c}`));
  }
  lines.push("", "## Steps", ...brief.steps.map((s, i) => `${i + 1}. ${s}`));
  lines.push("", "## Success criteria", ...brief.successCriteria.map((c) => `- ${c}`));
  if (brief.openQuestions.length) {
    lines.push("", "## Open questions", ...brief.openQuestions.map((q) => `- ${q}`));
  }
  return lines.join("\n");
}

export interface AgentBriefInput {
  task: Task;
  labelNames: string[];
  preferences: string[];
  modelId?: string | null;
  offline?: boolean;
}

export interface AgentBriefResult {
  markdown: string;
  meta: TriageMeta;
}

export async function generateAgentBrief(input: AgentBriefInput): Promise<AgentBriefResult> {
  const start = Date.now();

  if (input.offline) {
    const output = offlineBrief(input.task);
    return {
      markdown: briefToMarkdown(output),
      meta: {
        promptVersion: BRIEF_PROMPT_VERSION,
        model: OFFLINE_MODEL,
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
  const todayIso = new Date().toISOString().slice(0, 10);
  const result = await generateObject({
    model: resolved.model,
    schema: AgentBriefOutput,
    schemaName: "AgentBrief",
    schemaDescription: "Handoff brief for delegating a single task.",
    system: BRIEF_SYSTEM_PROMPT,
    prompt: buildBriefUserPrompt({
      task: input.task,
      labelNames: input.labelNames,
      preferences: input.preferences,
      todayIso,
    }),
    temperature: 0.2,
  });

  const inputTokens = result.usage?.inputTokens ?? null;
  const outputTokens = result.usage?.outputTokens ?? null;
  return {
    markdown: briefToMarkdown(result.object),
    meta: {
      promptVersion: BRIEF_PROMPT_VERSION,
      model: resolved.option.gatewaySlug,
      transport: resolved.transport,
      durationMs: Date.now() - start,
      inputTokens,
      outputTokens,
      costCents: estimateCostCents({ model: resolved.option, inputTokens, outputTokens }),
      offline: false,
    },
  };
}

/**
 * Deterministic template used with `?offline=1` / `SIFTY_AI_OFFLINE=1` —
 * keyless local dev and CI. Not a product feature.
 */
function offlineBrief(task: Task): AgentBriefOutput {
  const steps = task.subtasks.length
    ? task.subtasks.map((s) => s.title)
    : [
        task.nextAction ?? `Decide the first concrete step for: ${task.title}`,
        "Do the work in small, verifiable increments.",
        "Summarize what changed and what remains.",
      ];
  return AgentBriefOutput.parse({
    objective: task.title,
    context: [
      `Original capture: ${task.sourceText}`,
      ...(task.sourceContext ? [`Context: ${task.sourceContext}`] : []),
      ...(task.due ? [`Due: ${task.due}`] : []),
    ],
    steps:
      steps.length >= 2
        ? steps.slice(0, 8)
        : [...steps, "Review the result against the objective."],
    successCriteria: ["The objective above is demonstrably complete."],
    openQuestions: [],
  });
}
