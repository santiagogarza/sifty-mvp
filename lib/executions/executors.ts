import type { Execution, ExecutionDraft, ExecutorKind, Task } from "@/lib/domain/types";

/**
 * Executors: the workers an execution hands a task to.
 *
 * This file is the seam the connector framework (3.3) and the real
 * executors (3.4 model + MCP agent, 3.5 Cursor Cloud Agents) plug into.
 * The execution model owns everything around a run — the state machine,
 * the policy gate, the budget, the log, cancellation, the decisions the
 * run waits on — and an executor only has to implement `run()`:
 *
 *   - read `ctx.task` / `ctx.execution` / `ctx.answers`;
 *   - call `ctx.log()` for every tool and model call (inputs and outputs
 *     are redacted before they are stored);
 *   - call `ctx.checkCancelled()` between long operations;
 *   - return an `ExecutorOutcome`.
 *
 * An executor never opens decisions or touches the status itself: it
 * returns `needs_decision` to ask, `draft` to hand back something that
 * must be reviewed under `draft_then_approve`, or `done` for read-only
 * work that needs no sign-off. The run applies the policy.
 *
 * `readOnly` is the D9 switch: only read-only executors may run under
 * `auto`. Anything that sends, writes, or spends outside Sifty says
 * `readOnly: false` and is always gated.
 */

export interface ExecutorLogInput {
  kind: "tool_call" | "model_call" | "note";
  name: string;
  status?: "ok" | "error";
  input?: unknown;
  output?: unknown;
  durationMs?: number | null;
  /** Fractional cents; summed into the execution's settled cost. */
  costCents?: number;
}

export interface ExecutorContext {
  execution: Execution;
  task: Task;
  /** Answers the user gave to earlier `needs_decision` questions, oldest first. */
  answers: string[];
  offline: boolean;
  modelPreference: string | null;
  log(step: ExecutorLogInput): Promise<void>;
  /** Throws `ExecutionCancelledError` once the user asked the run to stop. */
  checkCancelled(): Promise<void>;
}

export type ExecutorOutcome =
  /** Finished; nothing to review (read-only work, or a result under `ask_first`). */
  | { kind: "done"; summary: string; draft: ExecutionDraft | null }
  /** Produced something that should be reviewed before it counts as done. */
  | { kind: "draft"; summary: string; draft: ExecutionDraft }
  /** Cannot continue without the user; the run suspends on an `approval` decision. */
  | { kind: "needs_decision"; question: string; options: string[] }
  | { kind: "failed"; error: string };

export interface ExecutorDefinition {
  kind: ExecutorKind;
  label: string;
  /** No side effects outside Sifty: `auto` may skip the human gate (D9). */
  readOnly: boolean;
  /** Connector slug the executor needs for this task, or null. */
  connectorFor(task: Task): string | null;
  /** Reserved against the monthly budget before the run starts. */
  estimateCents(task: Task): number;
  /** One line for the `ask_first` card: what Sifty wants to do. */
  describeAction(task: Task): string;
  run(ctx: ExecutorContext): Promise<ExecutorOutcome>;
}

export class ExecutionCancelledError extends Error {
  constructor() {
    super("Execution cancelled by the user");
    this.name = "ExecutionCancelledError";
  }
}

const MAX_TITLE = 120;

/**
 * The `research` executor, v0: a no-op that writes up what Sifty already
 * knows about the task as a short brief. It exists so the state machine,
 * the approvals, the budget, and the UI can be exercised end to end before
 * the model + MCP agent (3.4) replaces its body. Read-only by nature, so
 * it is the one executor `auto` is allowed on.
 */
export const researchExecutor: ExecutorDefinition = {
  kind: "research",
  label: "Research",
  readOnly: true,
  connectorFor: () => null,
  // What one Sonnet-class research pass will cost once 3.4 lands; the
  // skeleton settles at zero, the reservation exercises the budget path.
  estimateCents: () => 5,
  describeAction: (task) =>
    /^research\b/i.test(shortTitle(task))
      ? `Look into “${shortTitle(task)}” and write up notes`
      : `Research “${shortTitle(task)}” and write up notes`,
  async run(ctx) {
    await ctx.checkCancelled();
    const started = Date.now();
    const facts = [
      ctx.task.nextAction ? `- Next action: ${ctx.task.nextAction}` : null,
      ctx.task.description ? `- Context: ${ctx.task.description}` : null,
      ctx.task.plan?.approach ? `- Approach: ${ctx.task.plan.approach}` : null,
      ctx.task.plan?.blockers ? `- Blockers: ${ctx.task.plan.blockers}` : null,
      ...ctx.answers.map((a) => `- You said: ${a}`),
    ].filter((line): line is string => !!line);
    const body = [
      `# Research notes: ${shortTitle(ctx.task)}`,
      "",
      facts.length ? facts.join("\n") : "- Nothing beyond the capture itself yet.",
      "",
      "_Sifty's research agent is not connected yet; these notes restate what it knows._",
    ].join("\n");
    await ctx.log({
      kind: "note",
      name: "research.gather",
      input: {
        title: ctx.task.title,
        nextAction: ctx.task.nextAction,
        connectors: ctx.task.plan?.connectors ?? [],
      },
      output: { lines: facts.length },
      durationMs: Date.now() - started,
      costCents: 0,
    });
    return {
      kind: "draft",
      summary: `Research notes for “${shortTitle(ctx.task)}”`,
      draft: { title: `Research notes: ${shortTitle(ctx.task)}`, body, format: "markdown" },
    };
  },
};

function shortTitle(task: Pick<Task, "title" | "sourceText">): string {
  const title = (task.title || task.sourceText).trim();
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title;
}

const registry = new Map<ExecutorKind, ExecutorDefinition>([["research", researchExecutor]]);
const overrides = new Map<ExecutorKind, ExecutorDefinition>();

/** The executor for a kind, or null when it is not available yet (3.4 / 3.5). */
export function getExecutor(kind: ExecutorKind): ExecutorDefinition | null {
  return overrides.get(kind) ?? registry.get(kind) ?? null;
}

/** Kinds a user can pick today. */
export function availableExecutors(): ExecutorDefinition[] {
  return Array.from(registry.values()).map((def) => overrides.get(def.kind) ?? def);
}

/** Register a real executor (called once at module load by 3.4 / 3.5). */
export function registerExecutor(def: ExecutorDefinition): void {
  registry.set(def.kind, def);
}

export function setExecutorForTesting(kind: ExecutorKind, def: ExecutorDefinition | null): void {
  if (def) overrides.set(kind, def);
  else overrides.delete(kind);
}
