"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { isTriageInFlight, runTriage } from "@/lib/ai/run-triage";
import { LABEL_LIMITS, TASK_LIMITS } from "@/lib/domain/limits";
import { bucketLabel } from "@/lib/domain/priority";
import { STATUSES_IN_ORDER, STATUS_META, statusLabel } from "@/lib/domain/status";
import {
  type DelegationCandidate,
  type Effort,
  type Label,
  type Lifecycle,
  type Subtask,
  type Task,
  type TaskEditableField,
} from "@/lib/domain/types";
import { getSyncHooks, useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatExactTime, formatRelativeDay, isOverdue } from "@/lib/utils/dates";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  ArrowRight,
  Bot,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Plus,
  RotateCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";
import { AiThinking } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";
import { StatusIcon } from "./status-icon";

/**
 * The detail sheet is where the AI's work becomes user-visible and editable.
 *
 * Information architecture:
 *   1. Title + completion (the act, never hidden)
 *   2. Next action (the most actionable line)
 *   3. Meta strip: due, effort, delegation, status
 *   4. Subtasks (collapsible if absent)
 *   5. AI rationale + clarifying question (progressive disclosure)
 *   6. Filing strip (inbox only) + footer: source text, retry, delete
 *
 * Capture feedback: right after capture the sheet opens on the new task.
 * While Sifty organizes it, empty AI-populated slots show a quiet shimmer;
 * everything stays a live input the whole time (user edits win via
 * `editedFields`). When the result lands, the filled sections settle in
 * with a short stagger.
 */
export function TaskDetailSheet({
  taskId,
  onClose,
}: {
  taskId: string | null;
  onClose: () => void;
}) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const open = !!taskId && !!task;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent aria-describedby={undefined}>
        {task ? (
          <>
            <VisuallyHidden>
              <SheetTitle>{task.title || "Task details"}</SheetTitle>
            </VisuallyHidden>
            {/* Keyed so switching tasks resets local UI state (disclosures,
                fill animation tracking) instead of leaking across tasks. */}
            <DetailBody key={task.id} task={task} onClose={onClose} />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({ task, onClose }: { task: Task; onClose: () => void }) {
  const updateTask = useStore((s) => s.updateTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const labels = useStore((s) => s.labels);
  const ensureLabel = useStore((s) => s.ensureLabel);
  const addSubtask = useStore((s) => s.addSubtask);
  const toggleSubtask = useStore((s) => s.toggleSubtask);
  const removeSubtask = useStore((s) => s.removeSubtask);

  const isDone = task.lifecycle === "done";
  const overdue = isOverdue(task.due);

  const [showRationale, setShowRationale] = React.useState(false);
  const [showSource, setShowSource] = React.useState(false);

  // Organizing = triage genuinely in flight. The `isTriageInFlight` guard
  // keeps a stale "pending" row (e.g. restored from another device) from
  // shimmering forever; reactivity still comes from aiStatus updates.
  const organizing =
    task.aiStatus === "running" || (task.aiStatus === "pending" && isTriageInFlight(task.id));
  // First fill = the capture moment: nothing triaged yet, slots are blank.
  const firstFill = organizing && task.aiAttempts === 0;
  const edited = (f: TaskEditableField) => task.editedFields.includes(f);

  const justFilled = useJustFilled(task.aiStatus);
  const fillProps = (order: number, base: string) => ({
    className: cn(base, justFilled && "animate-fill-in"),
    style: justFilled ? { animationDelay: `${order * 45}ms` } : undefined,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg-elevated)]/95 backdrop-blur px-4 sm:px-5 py-3">
        <div className="flex items-center gap-2 text-[12px] text-[var(--fg-subtle)]">
          {organizing && task.priorityBucket === "unset" ? (
            <AiThinking />
          ) : (
            <>
              <PriorityGlyph bucket={task.priorityBucket} size={11} />
              <span>{bucketLabel(task.priorityBucket)}</span>
              {organizing ? (
                <span className="ml-2">
                  <AiThinking />
                </span>
              ) : null}
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => runTriage(task.id)}
            aria-label="Reorganize with Sifty"
            title="Reorganize with Sifty"
          >
            <RotateCw size={13} />
          </Button>
          <SheetClose asChild>
            <Button variant="ghost" size="iconSm" aria-label="Close">
              <X size={14} />
            </Button>
          </SheetClose>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-5">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() =>
              updateTask(task.id, {
                lifecycle: isDone ? "active" : "done",
              })
            }
            aria-label={isDone ? "Mark as not done" : "Mark as done"}
            className={cn(
              "mt-1 size-5 rounded-full border flex items-center justify-center shrink-0",
              "transition-all duration-150 ease-[var(--ease-product)]",
              "border-[var(--border-strong)] hover:border-[var(--accent)]",
              isDone && "bg-[var(--done)] border-[var(--done)]",
            )}
          >
            {isDone ? <Check size={12} className="text-white" strokeWidth={3} /> : null}
          </button>

          <input
            value={task.title}
            maxLength={TASK_LIMITS.title}
            onChange={(e) =>
              updateTask(task.id, { title: e.target.value }, { editedFields: ["title"] })
            }
            className={cn(
              "flex-1 bg-transparent text-[20px] leading-[1.25] font-medium tracking-[-0.015em]",
              "border-0 focus:outline-none placeholder:text-[var(--fg-subtle)]",
              isDone && "line-through text-[var(--fg-subtle)]",
            )}
            placeholder="Task title"
          />
        </div>

        {task.aiStatus === "failed" ? <OrganizeFailed task={task} /> : null}
        {task.clarifyingQuestion ? <ClarifyingQuestion task={task} /> : null}

        <section {...fillProps(0, "mt-5")}>
          <div className="text-eyebrow mb-1.5">Next action</div>
          <div className="group relative">
            <Textarea
              value={task.nextAction ?? ""}
              maxLength={TASK_LIMITS.nextAction}
              placeholder={
                firstFill && !task.nextAction ? "" : "What's the very next concrete step?"
              }
              onChange={(e) =>
                updateTask(
                  task.id,
                  { nextAction: e.target.value },
                  { editedFields: ["nextAction"] },
                )
              }
              rows={2}
              className="text-[14px] bg-[var(--surface-muted)] border-transparent leading-[1.5]"
            />
            {firstFill && !task.nextAction && !edited("nextAction") ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-3.5 top-[14px] flex flex-col gap-2 transition-opacity group-focus-within:opacity-0"
              >
                <AiFillSlot className="w-3/4" />
                <AiFillSlot className="w-2/5" />
              </span>
            ) : null}
          </div>
        </section>

        <section {...fillProps(1, "mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4")}>
          <MetaCell
            label="Due"
            value={formatRelativeDay(task.due) ?? "Unset"}
            pending={firstFill && !task.due && !edited("due")}
            tone={overdue ? "warn" : "neutral"}
            icon={<CalendarDays size={12} />}
          >
            <DueEditor task={task} />
          </MetaCell>
          <MetaCell
            label="Effort"
            value={effortLabel(task.effort)}
            pending={firstFill && !edited("effort")}
            icon={<Clock size={12} />}
          >
            <EffortPicker task={task} />
          </MetaCell>
          <MetaCell
            label="Delegate"
            value={delegationLabel(task.delegationCandidate)}
            pending={firstFill && !edited("delegationCandidate")}
          >
            <DelegationPicker task={task} />
          </MetaCell>
          <MetaCell
            label="Status"
            value={statusLabel(task.lifecycle)}
            icon={<StatusIcon status={task.lifecycle} size={12} />}
          >
            <StatusPicker task={task} />
          </MetaCell>
        </section>

        <section {...fillProps(2, "mt-5")}>
          <div className="text-eyebrow mb-2">Priority</div>
          <PriorityEditors task={task} />
        </section>

        <section {...fillProps(3, "mt-5")}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-eyebrow">Labels</div>
          </div>
          <LabelEditor
            task={task}
            labels={labels}
            ensureLabel={ensureLabel}
            pending={firstFill && task.labelIds.length === 0 && !edited("labelIds")}
          />
        </section>

        <section {...fillProps(4, "mt-5")}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-eyebrow">Subtasks</div>
            <span className="text-[11px] text-[var(--fg-subtle)] text-num">
              {task.subtasks.filter((st) => st.done).length}/{task.subtasks.length}
            </span>
          </div>
          <SubtaskList
            subtasks={task.subtasks}
            pending={firstFill && task.subtasks.length === 0 && !edited("subtasks")}
            onToggle={(id) => toggleSubtask(task.id, id)}
            onRemove={(id) => removeSubtask(task.id, id)}
            onAdd={(title) => addSubtask(task.id, title)}
          />
        </section>

        <AgentBriefSection task={task} />

        <section className="mt-6 pt-4 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={() => setShowRationale((v) => !v)}
            className="flex w-full items-center justify-between text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            <span className="flex items-center gap-1.5">
              <Sparkles size={12} className="text-[var(--ai)]" />
              AI rationale
            </span>
            <ChevronRight
              size={13}
              className={cn(
                "transition-transform duration-200 ease-[var(--ease-product)]",
                showRationale && "rotate-90",
              )}
            />
          </button>
          {showRationale ? (
            <div className="mt-2 rounded-[var(--radius-md)] bg-[var(--ai-soft)] px-3 py-2.5">
              <p className="text-[12.5px] leading-[1.55] text-[var(--fg-muted)] whitespace-pre-wrap">
                {task.rationale ?? "No rationale recorded yet."}
              </p>
              {task.confidence ? (
                <div className="mt-2 flex items-center gap-2 text-[11.5px] text-[var(--fg-subtle)]">
                  <span className="text-eyebrow">Confidence</span>
                  <ConfidenceMeter value={task.confidence} />
                  <span className="text-num">{Math.round(task.confidence * 100)}%</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            className="mt-3 flex w-full items-center justify-between text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            <span>Original capture</span>
            <ChevronRight
              size={13}
              className={cn(
                "transition-transform duration-200 ease-[var(--ease-product)]",
                showSource && "rotate-90",
              )}
            />
          </button>
          {showSource ? (
            <pre className="mt-2 whitespace-pre-wrap rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-3 py-2.5 font-sans text-[12.5px] text-[var(--fg-muted)] leading-[1.55]">
              {task.sourceText}
              {task.sourceContext ? `\n\n— Context —\n${task.sourceContext}` : ""}
            </pre>
          ) : null}
        </section>
      </div>

      <FilingStrip task={task} />

      <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-4 sm:px-5 py-3 bg-[var(--surface-muted)]">
        <span className="text-[11.5px] text-[var(--fg-subtle)]">
          Updated {formatExactTime(task.updatedAt)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm("Delete this task?")) {
                deleteTask(task.id);
                onClose();
              }
            }}
            aria-label="Delete task"
          >
            <Trash2 size={13} />
            <span className="hidden sm:inline">Delete</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

/** True for a moment after triage lands, driving the staggered settle-in. */
function useJustFilled(aiStatus: Task["aiStatus"]): boolean {
  const prevRef = React.useRef(aiStatus);
  const [justFilled, setJustFilled] = React.useState(false);

  React.useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = aiStatus;
    if ((prev === "running" || prev === "pending") && aiStatus === "ready") {
      setJustFilled(true);
      const t = setTimeout(() => setJustFilled(false), 1400);
      return () => clearTimeout(t);
    }
  }, [aiStatus]);

  return justFilled;
}

/** Quiet shimmer placeholder for a slot Sifty is about to fill. */
function AiFillSlot({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("ai-fill-shimmer block h-[9px] rounded-full", className)} />
  );
}

function OrganizeFailed({ task }: { task: Task }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-3.5 py-2">
      <span className="text-[12.5px] text-[var(--fg-muted)]">Sifty couldn't organize this.</span>
      <Button variant="ghost" size="sm" onClick={() => runTriage(task.id)}>
        <RotateCw size={12} />
        Retry
      </Button>
    </div>
  );
}

/** Statuses a reviewed inbox task most often moves to. */
const FILE_TARGETS: readonly Lifecycle[] = ["active", "waiting", "someday"];

/**
 * One-click filing for inbox tasks — the "which pile" step of triage.
 * After a move the strip becomes a short confirmation instead of
 * unmounting, so the action visibly landed; it fades away on its own.
 */
function FilingStrip({ task }: { task: Task }) {
  const updateTask = useStore((s) => s.updateTask);
  const [filed, setFiled] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const file = (to: Lifecycle) => {
    updateTask(task.id, { lifecycle: to });
    setFiled(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFiled(false), 2400);
  };

  const showConfirmation = filed && task.lifecycle !== "inbox";
  if (task.lifecycle !== "inbox" && !showConfirmation) return null;

  return (
    <div className="border-t border-[var(--border)] px-4 sm:px-5 py-2.5 bg-[var(--bg-elevated)]">
      {showConfirmation ? (
        <div className="flex items-center gap-2 py-0.5 text-[12.5px] text-[var(--fg-muted)] animate-fade-in">
          <Check size={13} className="text-[var(--done)]" strokeWidth={2.5} />
          <span>
            Moved to <span className="text-[var(--fg)]">{statusLabel(task.lifecycle)}</span>
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-eyebrow mr-1">Move to</span>
          {FILE_TARGETS.map((to) => (
            <button
              key={to}
              type="button"
              onClick={() => file(to)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)]",
                "px-2.5 py-1 text-[12px] text-[var(--fg-muted)]",
                "transition-colors duration-150 ease-[var(--ease-product)]",
                "hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
              )}
            >
              <StatusIcon status={to} size={12} className="opacity-80" />
              {statusLabel(to)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Prepare for agent" — generates a clean markdown handoff brief for the
 * task. The MVP never auto-launches an agent; the brief is copied out to
 * wherever the work will happen (an AI agent, a teammate, a doc).
 */
function AgentBriefSection({ task }: { task: Task }) {
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      // Let pending pushes land first so the server sees the task (and its
      // latest content) before generating from it.
      await getSyncHooks()?.waitForTask(task.id);
      const res = await fetch("/api/agent-brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          modelId: useStore.getState().preferredModelId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        task?: Task | null;
      };
      if (!res.ok) throw new Error(data.error || `Brief failed (${res.status})`);
      if (data.task) {
        const store = useStore.getState();
        if (getSyncHooks()?.isTaskDirty(task.id)) {
          // The user edited the task while the brief generated — keep
          // their edits and take only the brief (updateTask pushes, so
          // both sides converge).
          store.updateTask(task.id, { agentBrief: data.task.agentBrief });
        } else {
          store.replaceTaskFromServer(data.task);
        }
      }
      setExpanded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Brief generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const copy = async () => {
    if (!task.agentBrief) return;
    await navigator.clipboard.writeText(task.agentBrief);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="mt-5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-eyebrow flex items-center gap-1.5">
          <Bot size={12} className="text-[var(--ai)]" />
          Agent brief
        </div>
        <Button variant="ghost" size="sm" onClick={generate} disabled={generating}>
          {generating ? (
            <>
              <AiThinking /> Preparing…
            </>
          ) : task.agentBrief ? (
            <>
              <RotateCw size={12} /> Regenerate
            </>
          ) : (
            <>
              <Sparkles size={12} /> Prepare for agent
            </>
          )}
        </Button>
      </div>
      {error ? (
        <p className="text-[12.5px] text-[var(--warn)] leading-[1.5] mb-2">{error}</p>
      ) : null}
      {task.agentBrief ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)]">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            <span>Handoff brief — ready to copy</span>
            <ChevronRight
              size={13}
              className={cn(
                "transition-transform duration-200 ease-[var(--ease-product)]",
                expanded && "rotate-90",
              )}
            />
          </button>
          {expanded ? (
            <div className="px-3 pb-3">
              <pre className="whitespace-pre-wrap font-sans text-[12.5px] leading-[1.55] text-[var(--fg-muted)] max-h-64 overflow-y-auto">
                {task.agentBrief}
              </pre>
              <div className="mt-2 flex justify-end">
                <Button variant="ghost" size="sm" onClick={copy}>
                  <Copy size={12} />
                  {copied ? "Copied" : "Copy brief"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ClarifyingQuestion({ task }: { task: Task }) {
  const updateTask = useStore((s) => s.updateTask);
  const [answer, setAnswer] = React.useState("");
  return (
    <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3.5 py-3">
      <div className="flex items-start gap-2">
        <Sparkles size={13} className="text-[var(--accent)] mt-0.5" />
        <div className="flex-1">
          <div className="text-eyebrow mb-1 !text-[var(--accent)]">Sifty asks</div>
          <p className="text-[13.5px] leading-[1.5] text-[var(--fg)]">{task.clarifyingQuestion}</p>
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={answer}
              placeholder="Answer briefly…"
              onChange={(e) => setAnswer(e.target.value)}
              className="h-8 text-[13px] bg-[var(--bg)]"
            />
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                const trimmed = answer.trim();
                if (!trimmed) return;
                updateTask(
                  task.id,
                  {
                    sourceContext: task.sourceContext
                      ? `${task.sourceContext}\n\nAnswer: ${trimmed}`
                      : `Answer: ${trimmed}`,
                    clarifyingQuestion: null,
                  },
                  { editedFields: [] },
                );
                runTriage(task.id);
                setAnswer("");
              }}
            >
              Reply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaCell({
  label,
  value,
  icon,
  tone = "neutral",
  pending = false,
  children,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: "neutral" | "warn";
  /** While Sifty is deciding this value, show a shimmer instead of it. */
  pending?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]",
            "px-3 py-2 text-left transition-colors hover:bg-[var(--surface-hover)]",
            "flex flex-col gap-1",
          )}
        >
          <span className="text-eyebrow flex items-center gap-1">
            {icon}
            {label}
          </span>
          {pending ? (
            <AiFillSlot className="my-[5px] w-12" />
          ) : (
            <span
              className={cn(
                "text-[13px] text-[var(--fg)]",
                tone === "warn" && "text-[var(--warn)]",
              )}
            >
              {value}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent>{children}</PopoverContent>
    </Popover>
  );
}

function DueEditor({ task }: { task: Task }) {
  const updateTask = useStore((s) => s.updateTask);
  const today = new Date();
  const presets = [
    { label: "Today", days: 0 },
    { label: "Tomorrow", days: 1 },
    { label: "In 3 days", days: 3 },
    { label: "Next week", days: 7 },
  ];
  const toIso = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  return (
    <div className="flex flex-col gap-1 min-w-[220px]">
      {presets.map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={() => updateTask(task.id, { due: toIso(p.days) }, { editedFields: ["due"] })}
          className="flex items-center justify-between rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px] hover:bg-[var(--surface-hover)] text-left"
        >
          <span>{p.label}</span>
          <span className="text-[11.5px] text-[var(--fg-subtle)]">
            {new Date(toIso(p.days)).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        </button>
      ))}
      <div className="my-1 h-px bg-[var(--border)]" />
      <input
        type="date"
        value={task.due ?? ""}
        onChange={(e) =>
          updateTask(task.id, { due: e.target.value || null }, { editedFields: ["due"] })
        }
        className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--fg)]"
      />
      {task.due ? (
        <button
          type="button"
          onClick={() => updateTask(task.id, { due: null }, { editedFields: ["due"] })}
          className="rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[12.5px] text-[var(--fg-muted)] hover:bg-[var(--surface-hover)]"
        >
          Clear date
        </button>
      ) : null}
    </div>
  );
}

function EffortPicker({ task }: { task: Task }) {
  const updateTask = useStore((s) => s.updateTask);
  const options: Effort[] = ["quick", "small", "medium", "deep"];
  return (
    <div className="flex flex-col min-w-[180px]">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => updateTask(task.id, { effort: opt }, { editedFields: ["effort"] })}
          className={cn(
            "flex items-center justify-between rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--surface-hover)]",
            task.effort === opt && "bg-[var(--surface-hover)]",
          )}
        >
          <span>{effortLabel(opt)}</span>
          <span className="text-[11px] text-[var(--fg-subtle)]">{effortHint(opt)}</span>
        </button>
      ))}
    </div>
  );
}

function DelegationPicker({ task }: { task: Task }) {
  const updateTask = useStore((s) => s.updateTask);
  const options: DelegationCandidate[] = ["self", "ai", "person", "unsure"];
  return (
    <div className="flex flex-col min-w-[180px]">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() =>
            updateTask(
              task.id,
              { delegationCandidate: opt },
              { editedFields: ["delegationCandidate"] },
            )
          }
          className={cn(
            "flex items-center justify-between rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--surface-hover)]",
            task.delegationCandidate === opt && "bg-[var(--surface-hover)]",
          )}
        >
          <span>{delegationLabel(opt)}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Status picker — mirrors the sidebar exactly: same order, same words,
 * same icons, so moving a task here visibly lands it in that view.
 */
function StatusPicker({ task }: { task: Task }) {
  const updateTask = useStore((s) => s.updateTask);
  return (
    <div className="flex flex-col min-w-[240px]">
      {STATUSES_IN_ORDER.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => updateTask(task.id, { lifecycle: opt })}
          className={cn(
            "flex items-start gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left hover:bg-[var(--surface-hover)]",
            task.lifecycle === opt && "bg-[var(--surface-hover)]",
          )}
        >
          <StatusIcon status={opt} size={13} className="mt-[3px] text-[var(--fg-muted)]" />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] text-[var(--fg)]">{STATUS_META[opt].label}</span>
            <span className="block text-[11.5px] text-[var(--fg-subtle)] leading-[1.4]">
              {STATUS_META[opt].description}
            </span>
          </span>
          {task.lifecycle === opt ? (
            <Check size={13} className="mt-[3px] text-[var(--fg-muted)]" />
          ) : null}
        </button>
      ))}
    </div>
  );
}

function PriorityEditors({ task }: { task: Task }) {
  const updateTask = useStore((s) => s.updateTask);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Slider
        label="Urgency"
        value={task.urgency}
        onChange={(v) => updateTask(task.id, { urgency: v }, { editedFields: ["urgency"] })}
      />
      <Slider
        label="Importance"
        value={task.importance}
        onChange={(v) => updateTask(task.id, { importance: v }, { editedFields: ["importance"] })}
      />
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1">
        <span className="text-eyebrow">{label}</span>
        <span className="text-[11px] text-num text-[var(--fg-subtle)]">
          {Math.round(value * 100)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="w-full accent-[var(--accent)]"
      />
    </label>
  );
}

function LabelEditor({
  task,
  labels,
  ensureLabel,
  pending = false,
}: {
  task: Task;
  labels: Label[];
  ensureLabel: (name: string) => Label;
  pending?: boolean;
}) {
  const updateTask = useStore((s) => s.updateTask);
  const [adding, setAdding] = React.useState(false);
  const [input, setInput] = React.useState("");

  const labelMap = new Map(labels.map((l) => [l.id, l]));
  const taskLabels = task.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as Label[];
  const remaining = labels.filter((l) => !task.labelIds.includes(l.id));

  const atCap = task.labelIds.length >= TASK_LIMITS.maxLabels;

  const add = (name: string) => {
    const cleaned = name.trim();
    if (!cleaned || atCap) return;
    const label = ensureLabel(cleaned);
    if (!task.labelIds.includes(label.id)) {
      updateTask(
        task.id,
        { labelIds: [...task.labelIds, label.id] },
        { editedFields: ["labelIds"] },
      );
    }
    setInput("");
    setAdding(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pending ? (
        <>
          <AiFillSlot className="h-[18px] w-14 !rounded-full" />
          <AiFillSlot className="h-[18px] w-10 !rounded-full" />
        </>
      ) : null}
      {taskLabels.map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() =>
            updateTask(
              task.id,
              { labelIds: task.labelIds.filter((id) => id !== l.id) },
              { editedFields: ["labelIds"] },
            )
          }
          className="group"
          aria-label={`Remove ${l.name}`}
        >
          <Badge tone={l.tone}>
            {l.name}
            <X size={10} className="opacity-50 group-hover:opacity-100 transition-opacity" />
          </Badge>
        </button>
      ))}
      {adding ? (
        <Input
          autoFocus
          value={input}
          maxLength={LABEL_LIMITS.name}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(input);
            } else if (e.key === "Escape") {
              setAdding(false);
              setInput("");
            }
          }}
          onBlur={() => {
            if (input.trim()) add(input);
            else setAdding(false);
          }}
          placeholder="Label name"
          className="h-6 w-[140px] text-[12px]"
        />
      ) : atCap ? null : (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border-strong)] px-2 py-0.5 text-[11.5px] text-[var(--fg-muted)] hover:bg-[var(--surface-hover)]"
            >
              <Plus size={10} /> Add label
            </button>
          </PopoverTrigger>
          <PopoverContent align="start">
            <div className="flex flex-col gap-0.5 min-w-[180px]">
              {remaining.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => add(l.name)}
                  className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[13px] hover:bg-[var(--surface-hover)]"
                >
                  <Badge tone={l.tone}>{l.name}</Badge>
                </button>
              ))}
              <div className="my-1 h-px bg-[var(--border)]" />
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[12.5px] text-[var(--fg-muted)] hover:bg-[var(--surface-hover)]"
              >
                <Plus size={11} /> New label
              </button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function SubtaskList({
  subtasks,
  pending = false,
  onToggle,
  onRemove,
  onAdd,
}: {
  subtasks: Subtask[];
  pending?: boolean;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (title: string) => void;
}) {
  const [draft, setDraft] = React.useState("");
  return (
    <div className="flex flex-col gap-1">
      {pending ? (
        <div className="flex flex-col gap-2.5 px-1.5 py-1" aria-hidden>
          <div className="flex items-center gap-2">
            <span className="size-[14px] rounded-full border border-[var(--border)]" />
            <AiFillSlot className="w-2/3" />
          </div>
          <div className="flex items-center gap-2">
            <span className="size-[14px] rounded-full border border-[var(--border)]" />
            <AiFillSlot className="w-1/2" />
          </div>
        </div>
      ) : null}
      {subtasks.map((st) => (
        <div
          key={st.id}
          className="group flex items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 hover:bg-[var(--surface-muted)]"
        >
          <button
            type="button"
            onClick={() => onToggle(st.id)}
            className={cn(
              "size-[14px] rounded-full border flex items-center justify-center shrink-0",
              st.done ? "bg-[var(--done)] border-[var(--done)]" : "border-[var(--border-strong)]",
            )}
            aria-label={st.done ? "Mark incomplete" : "Mark complete"}
          >
            {st.done ? <Check size={9} className="text-white" strokeWidth={3} /> : null}
          </button>
          <span
            className={cn(
              "flex-1 text-[13px] leading-[1.45]",
              st.done && "text-[var(--fg-subtle)] line-through",
            )}
          >
            {st.title}
          </span>
          <button
            type="button"
            onClick={() => onRemove(st.id)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--fg-subtle)] hover:text-[var(--warn)]"
            aria-label="Remove subtask"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      {subtasks.length < TASK_LIMITS.maxSubtasks ? (
        <div className="flex items-center gap-2 mt-1">
          <ArrowRight size={12} className="text-[var(--fg-subtle)]" />
          <input
            value={draft}
            maxLength={TASK_LIMITS.subtaskTitle}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                e.preventDefault();
                onAdd(draft);
                setDraft("");
              }
            }}
            placeholder="Add a subtask"
            className="flex-1 bg-transparent text-[13px] text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:outline-none"
          />
        </div>
      ) : null}
    </div>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <span className="relative h-1 w-20 overflow-hidden rounded-full bg-[var(--surface-hover)]">
      <span className="absolute inset-y-0 left-0 bg-[var(--ai)]" style={{ width: `${pct}%` }} />
    </span>
  );
}

function effortLabel(e: Effort): string {
  return { quick: "Quick", small: "Small", medium: "Medium", deep: "Deep" }[e];
}
function effortHint(e: Effort): string {
  return { quick: "<10 min", small: "<30 min", medium: "1–3 hr", deep: "Multi-session" }[e];
}
function delegationLabel(d: DelegationCandidate): string {
  return { self: "Me", ai: "AI agent", person: "A person", unsure: "Unsure" }[d];
}
