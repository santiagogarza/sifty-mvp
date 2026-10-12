"use client";

import { Button } from "@/components/ui/button";
import * as React from "react";

type PingState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; runId: string; status: string; detail: string | null };

/**
 * One button that starts `pingWorkflow` and shows the outcome. Proves the
 * Workflow runtime (queue trigger, flow route, storage) works on this
 * deployment without capturing a task.
 */
export function WorkflowPing() {
  const [state, setState] = React.useState<PingState>({ kind: "idle" });

  const run = async () => {
    setState({ kind: "running" });
    try {
      const res = await fetch("/api/admin/workflow-ping", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        runId?: string;
        status?: string;
        error?: string;
        detail?: string;
        value?: { echo?: string };
      };
      if (!res.ok) {
        setState({
          kind: "done",
          runId: body.runId ?? "—",
          status: "not started",
          detail: body.detail ?? body.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setState({
        kind: "done",
        runId: body.runId ?? "—",
        status: body.status ?? "unknown",
        detail:
          body.status === "completed" ? `echo ${body.value?.echo ?? ""}` : (body.error ?? null),
      });
    } catch (err) {
      setState({
        kind: "done",
        runId: "—",
        status: "request failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 max-w-2xl">
      <p className="text-[13px] text-[var(--fg-muted)] leading-[1.5]">
        Starts a one-step workflow and waits up to 20 seconds for it to finish. A completed run
        means Vercel Workflow is enabled for this deployment.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={run} disabled={state.kind === "running"}>
          {state.kind === "running" ? "Running…" : "Run workflow ping"}
        </Button>
        {state.kind === "done" ? (
          <span className="text-[12.5px] text-[var(--fg)] tabular-nums" data-testid="ping-result">
            <span
              className={state.status === "completed" ? "text-[var(--ai)]" : "text-[var(--warn)]"}
            >
              {state.status}
            </span>
            {state.detail ? (
              <span className="text-[var(--fg-muted)]"> · {state.detail}</span>
            ) : null}
            <span className="text-[var(--fg-subtle)]"> · {state.runId}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
