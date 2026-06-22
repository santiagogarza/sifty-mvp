"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import { runTriage } from "@/lib/ai/run-triage";
import { bucketLabel } from "@/lib/domain/priority";
import {
  type DelegationCandidate,
  type Effort,
  type Label,
  type Lifecycle,
  type Subtask,
  type Task,
} from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatExactTime, formatRelativeDay, isOverdue } from "@/lib/utils/dates";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  Plus,
  RotateCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";
import { AiThinking } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

/**
 * The detail sheet is where the AI's work becomes user-visible and editable.
 *
 * Information architecture:
 *   1. Title + completion (the act, never hidden)
 *   2. Next action (the most actionable line)
 *   3. Meta strip: due, effort, delegation, labels
 *   4. Subtasks (collapsible if absent)
 *   5. AI rationale + clarifying question (progressive disclosure)
 *   6. Footer: source text, retry, delete
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
      <SheetContent>{task ? <DetailBody task={task} onClose={onClose} /> : null}</SheetContent>
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

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg-elevated)]/95 backdrop-blur px-4 sm:px-5 py-3">
        <div className="flex items-center gap-2 text-[12px] text-[var(--fg-subtle)]">
          <PriorityGlyph bucket={task.priorityBucket} size={11} />
          <span>{bucketLabel(task.priorityBucket)}</span>
          {task.aiStatus === "running" || task.aiStatus === "pending" ? (
            <span className="ml-2">
              <AiThinking />
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => runTriage(task.id)}
            aria-label="Re-run triage"
            title="Re-run triage"
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

        {task.clarifyingQuestion ? <ClarifyingQuestion task={task} /> : null}

        <section className="mt-5">
          <div className="text-eyebrow mb-1.5">Next action</div>
          <Textarea
            value={task.nextAction ?? ""}
            placeholder="What's the very next concrete step?"
            onChange={(e) =>
              updateTask(task.id, { nextAction: e.target.value }, { editedFields: ["nextAction"] })
            }
            rows={2}
            className="text-[14px] bg-[var(--surface-muted)] border-transparent leading-[1.5]"
          />
        </section>

        <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetaCell
            label="Due"
            value={formatRelativeDay(task.due) ?? "Unset"}
            tone={overdue ? "warn" : "neutral"}
            icon={<CalendarDays size={12} />}
          >
            <DueEditor task={task} />
          </MetaCell>
          <MetaCell label="Effort" value={effortLabel(task.effort)} icon={<Clock size={12} />}>
            <EffortPicker task={task} />
          </MetaCell>
          <MetaCell label="Delegate" value={delegationLabel(task.delegationCandidate)}>
            <DelegationPicker task={task} />
          </MetaCell>
          <MetaCell label="Lifecycle" value={lifecycleLabel(task.lifecycle)}>
            <LifecyclePicker task={task} />
          </MetaCell>
        </section>

        <section className="mt-5">
          <div className="text-eyebrow mb-2">Priority</div>
          <PriorityEditors task={task} />
        </section>

        <section className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-eyebrow">Labels</div>
          </div>
          <LabelEditor task={task} labels={labels} ensureLabel={ensureLabel} />
        </section>

        <section className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-eyebrow">Subtasks</div>
            <span className="text-[11px] text-[var(--fg-subtle)] text-num">
              {task.subtasks.filter((st) => st.done).length}/{task.subtasks.length}
            </span>
          </div>
          <SubtaskList
            subtasks={task.subtasks}
            onToggle={(id) => toggleSubtask(task.id, id)}
            onRemove={(id) => removeSubtask(task.id, id)}
            onAdd={(title) => addSubtask(task.id, title)}
          />
        </section>

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
  children,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: "neutral" | "warn";
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
          <span
            className={cn("text-[13px] text-[var(--fg)]", tone === "warn" && "text-[var(--warn)]")}
          >
            {value}
          </span>
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

function LifecyclePicker({ task }: { task: Task }) {
  const updateTask = useStore((s) => s.updateTask);
  const options: Lifecycle[] = ["inbox", "active", "waiting", "someday", "done", "dropped"];
  return (
    <div className="flex flex-col min-w-[180px]">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => updateTask(task.id, { lifecycle: opt })}
          className={cn(
            "flex items-center justify-between rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--surface-hover)]",
            task.lifecycle === opt && "bg-[var(--surface-hover)]",
          )}
        >
          <span>{lifecycleLabel(opt)}</span>
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
}: {
  task: Task;
  labels: Label[];
  ensureLabel: (name: string) => Label;
}) {
  const updateTask = useStore((s) => s.updateTask);
  const [adding, setAdding] = React.useState(false);
  const [input, setInput] = React.useState("");

  const labelMap = new Map(labels.map((l) => [l.id, l]));
  const taskLabels = task.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as Label[];
  const remaining = labels.filter((l) => !task.labelIds.includes(l.id));

  const add = (name: string) => {
    const cleaned = name.trim();
    if (!cleaned) return;
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
      ) : (
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
  onToggle,
  onRemove,
  onAdd,
}: {
  subtasks: Subtask[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (title: string) => void;
}) {
  const [draft, setDraft] = React.useState("");
  return (
    <div className="flex flex-col gap-1">
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
      <div className="flex items-center gap-2 mt-1">
        <ArrowRight size={12} className="text-[var(--fg-subtle)]" />
        <input
          value={draft}
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
function lifecycleLabel(l: Lifecycle): string {
  return {
    inbox: "Inbox",
    active: "Active",
    waiting: "Waiting",
    someday: "Someday",
    done: "Done",
    dropped: "Dropped",
  }[l];
}
