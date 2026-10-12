"use client";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { EXECUTION_CHANGED_EVENT } from "@/lib/decisions/client";
import {
  EXECUTION_POLICIES,
  EXECUTION_POLICY_LABELS,
  type Execution,
  type ExecutionPolicy,
  type ExecutionStep,
  type Task,
} from "@/lib/domain/types";
import { formatCents } from "@/lib/entitlements/entitlements";
import {
  isLive,
  selectTaskExecutions,
  useExecutionsStore,
  watchExecution,
} from "@/lib/executions/client";
import { executorLabel, policyDescription } from "@/lib/executions/copy";
import { DEFAULT_EXECUTION_POLICY } from "@/lib/executions/policy";
import { EXECUTION_STATUS_LABELS, isTerminal, isWaiting } from "@/lib/executions/state";
import { cn } from "@/lib/utils/cn";
import { formatTimeAgo } from "@/lib/utils/dates";
import { ArrowRight, Bot, ChevronRight, Play, Square } from "lucide-react";
import Link from "next/link";
import * as React from "react";

/**
 * "Let Sifty do it" — the task sheet's view of autonomous execution.
 *
 * One primary action (Run now) with the autonomy policy next to it as a
 * default that can be changed in place (default bias: `draft_then_approve`
 * is pre-selected and explained in one line). While Sifty works the panel
 * shows the live status; when it waits on the user the panel points at
 * the Decisions inbox rather than duplicating the approval UI; when it is
 * done the result is right here, with the step log one disclosure away.
 */
export function ExecutionSection({ task }: { task: Task }) {
  const data = useExecutionsStore((s) => selectTaskExecutions(s, task.id));
  const refresh = useExecutionsStore((s) => s.refresh);
  const start = useExecutionsStore((s) => s.start);
  const cancel = useExecutionsStore((s) => s.cancel);
  const [policy, setPolicy] = React.useState<ExecutionPolicy>(DEFAULT_EXECUTION_POLICY);
  const [policySaved, setPolicySaved] = React.useState(false);
  // Until the user picks, the server resolves the task's saved policy.
  const policyPicked = React.useRef(false);
  const [busy, setBusy] = React.useState<"start" | "cancel" | null>(null);
  const [denied, setDenied] = React.useState<{ code: string | null; error: string } | null>(null);

  const latest = data.executions[0];
  const live = isLive(latest);

  React.useEffect(() => {
    void refresh(task.id);
    policyPicked.current = false;
    let cancelled = false;
    void fetch(`/api/execution-policies?scope=task&key=${encodeURIComponent(task.id)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { policy?: ExecutionPolicy; saved?: boolean } | null) => {
        if (cancelled || policyPicked.current || !body?.policy) return;
        setPolicy(body.policy);
        setPolicySaved(!!body.saved);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [task.id, refresh]);

  React.useEffect(() => {
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ taskId: string }>).detail;
      if (detail?.taskId === task.id) void refresh(task.id);
    };
    const onFocus = () => void refresh(task.id);
    window.addEventListener(EXECUTION_CHANGED_EVENT, onChanged);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener(EXECUTION_CHANGED_EVENT, onChanged);
      window.removeEventListener("focus", onFocus);
    };
  }, [task.id, refresh]);

  React.useEffect(() => {
    if (latest && live) watchExecution(latest.id);
  }, [latest, live]);

  const run = async () => {
    if (busy) return;
    setBusy("start");
    setDenied(null);
    const result = await start(task.id, { policy: policyPicked.current ? policy : null });
    setBusy(null);
    if (!result.ok) {
      if (result.status === 402) setDenied({ code: result.code, error: result.error });
      else toast(result.error);
      if (result.execution) useExecutionsStore.getState().adopt(result.execution);
      return;
    }
    watchExecution(result.execution.id);
    toast(
      result.execution.policy === "ask_first"
        ? "Sifty will ask before it starts — check Decisions."
        : "Sifty is on it. You'll find the draft in Decisions.",
    );
  };

  const stop = async () => {
    if (!latest || busy) return;
    setBusy("cancel");
    const result = await cancel(task.id, latest.id);
    setBusy(null);
    if (!result.ok) toast(result.error);
    else toast(result.execution.status === "cancelled" ? "Stopped." : "Stopping at the next step.");
  };

  const changePolicy = async (next: ExecutionPolicy) => {
    policyPicked.current = true;
    setPolicy(next);
    try {
      const res = await fetch("/api/execution-policies", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "task", key: task.id, policy: next }),
      });
      setPolicySaved(res.ok);
    } catch {
      setPolicySaved(false);
    }
  };

  return (
    <section className="mt-6" data-testid="execution-section">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-eyebrow">Let Sifty do it</div>
        {latest ? (
          <span className="text-[11px] text-[var(--fg-subtle)] text-num">
            {data.executions.length === 1 ? "1 run" : `${data.executions.length} runs`}
          </span>
        ) : null}
      </div>

      {latest ? <ExecutionCard execution={latest} steps={data.steps} /> : null}

      {!latest || isTerminal(latest.status) ? (
        <div className={cn("flex flex-col gap-2", latest && "mt-3")}>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={latest ? "secondary" : "primary"}
              onClick={() => void run()}
              disabled={!!busy}
              data-testid="execution-run"
            >
              <Play size={13} />
              {latest ? "Run again" : "Run now"}
            </Button>
            <label className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--fg-muted)]">
              <span className="sr-only">Autonomy for this task</span>
              <select
                aria-label="Autonomy for this task"
                value={policy}
                disabled={!!busy}
                onChange={(e) => void changePolicy(e.target.value as ExecutionPolicy)}
                className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[13px] text-[var(--fg)] disabled:opacity-40"
                data-testid="execution-policy"
              >
                {EXECUTION_POLICIES.map((p) => (
                  <option key={p} value={p}>
                    {EXECUTION_POLICY_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-[12px] leading-[1.5] text-[var(--fg-subtle)]">
            {policyDescription(policy)}
            {policySaved ? " Saved for this task." : ""}
          </p>
          {denied ? (
            <div
              className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-3.5 py-2"
              data-testid="execution-denied"
            >
              <span className="text-[12.5px] text-[var(--fg-muted)]">{denied.error}</span>
              {denied.code === "execution_pro" ? (
                <Link
                  href="/settings/billing"
                  className="shrink-0 inline-flex items-center gap-1 text-[12.5px] text-[var(--accent)] hover:underline"
                >
                  See plans
                  <ArrowRight size={12} />
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          {isWaiting(latest.status) && latest.decisionId ? (
            <Link
              href={`/decisions?focus=${encodeURIComponent(latest.decisionId)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 text-[13px] font-medium text-[var(--accent-fg)] hover:brightness-110"
              data-testid="execution-review-link"
            >
              {latest.status === "drafted" ? "Review the draft" : "Answer in Decisions"}
              <ArrowRight size={12} />
            </Link>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void stop()}
            disabled={!!busy}
            className="text-[var(--fg-muted)]"
            data-testid="execution-cancel"
          >
            <Square size={12} />
            Stop
          </Button>
        </div>
      )}
    </section>
  );
}

const STATUS_TONE: Record<Execution["status"], string> = {
  queued: "bg-[var(--fg-subtle)]",
  running: "bg-[var(--ai)] animate-pulse-soft",
  needs_decision: "bg-[var(--accent)]",
  needs_approval: "bg-[var(--accent)]",
  drafted: "bg-[var(--accent)]",
  done: "bg-[var(--done)]",
  failed: "bg-[var(--warn)]",
  cancelled: "bg-[var(--fg-subtle)]",
};

function ExecutionCard({ execution, steps }: { execution: Execution; steps: ExecutionStep[] }) {
  const [showSteps, setShowSteps] = React.useState(false);
  const [showResult, setShowResult] = React.useState(execution.status === "done");
  const detail = describeExecution(execution);

  // The result opens itself the moment a run finishes while the sheet is up.
  React.useEffect(() => {
    if (execution.status === "done") setShowResult(true);
  }, [execution.status]);

  return (
    <div
      className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)]/60 px-3.5 py-3"
      data-testid="execution-card"
      data-execution-status={execution.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Bot size={13} className="mt-[3px] shrink-0 text-[var(--accent)]" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13px] text-[var(--fg)]">
              <span
                className={cn("size-[7px] shrink-0 rounded-full", STATUS_TONE[execution.status])}
              />
              <span data-testid="execution-status">
                {EXECUTION_STATUS_LABELS[execution.status]}
              </span>
              <span className="text-[11.5px] text-[var(--fg-subtle)]">
                · {executorLabel(execution.executor)} · {EXECUTION_POLICY_LABELS[execution.policy]}
              </span>
            </div>
            {detail ? (
              <p className="mt-1 text-[12.5px] leading-[1.5] text-[var(--fg-muted)]">{detail}</p>
            ) : null}
          </div>
        </div>
        <span className="shrink-0 text-[11.5px] text-[var(--fg-subtle)] tabular-nums">
          {formatTimeAgo(execution.finishedAt ?? execution.startedAt ?? execution.createdAt)}
        </span>
      </div>

      {execution.result?.draft && execution.status === "done" ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowResult((v) => !v)}
            className="flex w-full items-center justify-between text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
            aria-expanded={showResult}
          >
            <span>{execution.result.draft.title ?? "Result"}</span>
            <ChevronRight
              size={13}
              className={cn("transition-transform duration-200", showResult && "rotate-90")}
            />
          </button>
          {showResult ? (
            <pre
              data-testid="execution-result"
              className="mt-1.5 whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--bg)] px-3 py-2 font-sans text-[12.5px] leading-[1.55] text-[var(--fg-muted)]"
            >
              {execution.result.draft.body}
            </pre>
          ) : null}
        </div>
      ) : null}

      {steps.length ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowSteps((v) => !v)}
            className="flex w-full items-center justify-between text-[12px] text-[var(--fg-subtle)] hover:text-[var(--fg)]"
            aria-expanded={showSteps}
            data-testid="execution-steps-toggle"
          >
            <span>
              {steps.length === 1 ? "1 step" : `${steps.length} steps`}
              {execution.costCents ? ` · ${formatCents(execution.costCents)}` : ""}
            </span>
            <ChevronRight
              size={13}
              className={cn("transition-transform duration-200", showSteps && "rotate-90")}
            />
          </button>
          {showSteps ? (
            <ol className="mt-1.5 flex flex-col gap-1" data-testid="execution-steps">
              {steps.map((step) => (
                <li
                  key={step.id}
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--bg)] px-2.5 py-1.5 text-[12px]"
                >
                  <span className="min-w-0 truncate text-[var(--fg)]">
                    <span className="text-[var(--fg-subtle)] text-num mr-2">{step.seq + 1}</span>
                    {step.name}
                    <span className="ml-2 text-[var(--fg-subtle)]">
                      {step.kind.replace("_", " ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-[var(--fg-subtle)] text-num">
                    {step.status === "error" ? "failed · " : ""}
                    {step.durationMs !== null ? `${step.durationMs} ms` : ""}
                    {step.costCents ? ` · ${formatCents(step.costCents)}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function describeExecution(execution: Execution): string | null {
  switch (execution.status) {
    case "queued":
      return "Waiting for a free slot.";
    case "running":
      return execution.cancelRequested ? "Stopping at the next step…" : "Sifty is working on it.";
    case "needs_approval":
      return "Sifty asked before starting. Approve or reject it in Decisions.";
    case "needs_decision":
      return "Sifty has a question before it can continue.";
    case "drafted":
      return "There is a draft to review. Approve it, edit it, or reject it in Decisions.";
    case "done":
      return execution.result?.summary ?? "Done.";
    case "failed":
      return execution.error ?? "Something went wrong.";
    case "cancelled":
      switch (execution.cancelReason) {
        case "rejected":
          return "You rejected it.";
        case "expired":
          return "No answer within a week, so Sifty stopped.";
        default:
          return "Stopped.";
      }
  }
}
