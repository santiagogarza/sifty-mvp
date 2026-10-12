"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { type PublicDailyPlan, describeMove } from "@/lib/ai/plan/public";
import { useStore } from "@/lib/store/store";
import { syncFromServer } from "@/lib/store/sync";
import { formatExactTime } from "@/lib/utils/dates";
import { CalendarCheck, Loader2 } from "lucide-react";
import * as React from "react";

/**
 * The daily plan, above the Today list: what the night (or the last
 * "Re-plan today") decided and why, move by move. Each move opens its
 * task. Hidden for accounts without the feature until a plan exists, so
 * the free tier is never nagged on its own Today page.
 *
 * While a plan runs the card polls `GET /api/plan`; when it finishes the
 * workspace is pulled so the list below reflects the new scores.
 */

interface PlanState {
  plan: PublicDailyPlan | null;
  running: boolean;
  canReplan: boolean;
}

const POLL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;
const MOVES_SHOWN = 5;

async function fetchPlan(): Promise<PlanState | null> {
  const res = await fetch("/api/plan", { credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as PlanState;
}

export function DailyPlanCard() {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const modelPreference = useStore((s) => s.modelPreference);
  const [state, setState] = React.useState<PlanState | null>(null);
  const [requesting, setRequesting] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetchPlan().then((s) => {
      if (!cancelled && s) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Only the server's lease-aware `running` flag counts: a plan row left
  // `running` by a lost workflow must not disable Re-plan forever.
  const running = !!state?.running;
  React.useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const startedAt = Date.now();
    const tick = async () => {
      const next = await fetchPlan();
      if (cancelled) return;
      if (next) setState(next);
      const stillRunning = !!next?.running;
      if (stillRunning && Date.now() - startedAt < POLL_TIMEOUT_MS) {
        timer = setTimeout(tick, POLL_MS);
      } else if (stillRunning) {
        // Give up polling but hand the button back; the next visit re-reads.
        setState((s) => (s ? { ...s, running: false } : s));
      } else {
        void syncFromServer();
      }
    };
    let timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [running]);

  const replan = async () => {
    setRequesting(true);
    try {
      const res = await fetch("/api/plan/replan", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          modelPreference,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        plan?: PublicDailyPlan;
        error?: string;
      };
      if (res.status === 202 || res.status === 409) {
        setState((s) => ({
          plan: body.plan ?? s?.plan ?? null,
          running: true,
          canReplan: s?.canReplan ?? true,
        }));
      } else {
        toast(body.error ?? "Planning could not start — try again.");
      }
    } catch {
      toast("Can't reach Sifty — try again in a moment.");
    } finally {
      setRequesting(false);
    }
  };

  if (!state) return null;
  const { plan, canReplan } = state;
  if (!plan && !canReplan) return null;

  const moves = plan?.moves ?? [];
  const visibleMoves = showAll ? moves : moves.slice(0, MOVES_SHOWN);
  const taskIds = new Set(tasks.map((t) => t.id));

  return (
    <section
      aria-labelledby="daily-plan-title"
      data-testid="daily-plan-card"
      className="relative mb-6 rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-elevated)] px-5 py-4 shadow-sm animate-fade-in"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[var(--ai)]">
            <CalendarCheck size={13} />
            <span className="text-eyebrow !text-[var(--ai)]">Daily plan</span>
          </div>
          <h2
            id="daily-plan-title"
            className="mt-1.5 text-[15px] font-medium leading-[1.45] tracking-[-0.01em] text-[var(--fg)]"
          >
            {running
              ? "Sifty is planning your day…"
              : plan?.status === "running"
                ? "The last plan did not finish. Re-plan to try again."
                : plan?.status === "failed"
                  ? (plan.error ?? "Planning failed — try again.")
                  : (plan?.summary ?? "Sifty can re-rank Today against everything on your list.")}
          </h2>
        </div>
        {canReplan ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={replan}
            disabled={running || requesting}
            data-testid="replan-today"
            className="shrink-0"
          >
            {running || requesting ? <Loader2 size={13} className="animate-spin" /> : null}
            {running ? "Planning…" : "Re-plan today"}
          </Button>
        ) : null}
      </div>

      {!running && visibleMoves.length > 0 ? (
        <ul className="mt-3 space-y-1.5" data-testid="daily-plan-moves">
          {visibleMoves.map((m) => {
            const message = describeMove(m.kind, m.reason);
            const inWorkspace = taskIds.has(m.taskId);
            return (
              <li key={m.taskId} className="text-[13px] leading-[1.5]">
                <button
                  type="button"
                  onClick={() => openDetail(m.taskId)}
                  disabled={!inWorkspace}
                  className="text-left text-[var(--fg)] hover:underline disabled:no-underline disabled:opacity-70"
                >
                  {m.title}
                </button>
                <span className="text-[var(--fg-muted)]"> — {message}</span>
              </li>
            );
          })}
          {moves.length > MOVES_SHOWN && !showAll ? (
            <li>
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
              >
                and {moves.length - MOVES_SHOWN} more
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}

      {plan && !running && plan.status !== "running" ? (
        <p className="mt-3 text-[12px] text-[var(--fg-subtle)]">
          {plan.status === "completed"
            ? `Planned ${formatExactTime(plan.finishedAt ?? plan.createdAt)} · ${
                moves.length === 0
                  ? "nothing moved"
                  : moves.length === 1
                    ? "1 move"
                    : `${moves.length} moves`
              } · ${plan.considered} open ${plan.considered === 1 ? "task" : "tasks"} considered`
            : `Attempted ${formatExactTime(plan.finishedAt ?? plan.createdAt)}`}
        </p>
      ) : null}
    </section>
  );
}
