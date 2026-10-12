"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { toast } from "@/components/ui/toast";
import {
  type AnswerOutcome,
  type DecisionTaskSummary,
  isApprovable,
  useDecisionsStore,
} from "@/lib/decisions/client";
import { REMEMBER_OPTION } from "@/lib/decisions/copy";
import { DECISION_LIMITS } from "@/lib/domain/limits";
import type { Decision, ExecutionDraft } from "@/lib/domain/types";
import { APPROVE_OPTION, REJECT_OPTION } from "@/lib/executions/copy";
import { cn } from "@/lib/utils/cn";
import { formatTimeAgo } from "@/lib/utils/dates";
import { ArrowUpRight, Check, CheckCheck, Sparkles } from "lucide-react";
import * as React from "react";
import {
  ApprovalBody,
  type ApprovalHandle,
  DraftReviewBody,
  type DraftReviewHandle,
} from "./execution-cards";

/**
 * The Decisions inbox: everything waiting on the human, newest first.
 *
 * Each card is one decision and resolves in one gesture: tap an option,
 * approve, or type a line and press Enter. Dismissing ("Let Sifty
 * decide" / "Reject") is always one click away and never hidden, so the
 * inbox can be cleared without being answered. Keyboard mirrors the task
 * list: `j`/`k` and the arrows move, `Enter` jumps into the answer field
 * (or opens the draft editor), `1`–`4` tap an option, `e` edits a draft,
 * `x` selects for a batch approve, `d` dismisses / rejects, `Esc` returns
 * to the list.
 *
 * Batch approve exists for the morning-after case (several drafts waiting)
 * and deliberately adds one step: the bar shows the count, and the button
 * asks for a second click before anything is applied.
 */
export function DecisionsInbox({
  decisions,
  tasks,
  focusId,
  emptyState,
}: {
  decisions: Decision[];
  tasks: Record<string, DecisionTaskSummary>;
  /** Deep-linked decision (`?focus=`): starts active and scrolled into view. */
  focusId?: string | null;
  emptyState: React.ReactNode;
}) {
  const [activeIndex, setActiveIndex] = React.useState<number>(() => {
    const i = focusId ? decisions.findIndex((d) => d.id === focusId) : -1;
    return i >= 0 ? i : decisions.length ? 0 : -1;
  });
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set());
  const listRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef<Map<string, DecisionCardHandle>>(new Map());
  const didInitialFocus = React.useRef(false);

  React.useEffect(() => {
    if (activeIndex >= decisions.length) setActiveIndex(decisions.length - 1);
  }, [decisions.length, activeIndex]);

  // Selection only ever names cards that are still open.
  React.useEffect(() => {
    setSelected((prev) => {
      const live = new Set(decisions.filter((d) => prev.has(d.id)).map((d) => d.id));
      return live.size === prev.size ? prev : live;
    });
  }, [decisions]);

  React.useEffect(() => {
    if (decisions.length === 0 || didInitialFocus.current) return;
    didInitialFocus.current = true;
    const target = focusId ? cardRefs.current.get(focusId) : null;
    if (target) {
      target.focusCard();
      target.scrollIntoView();
    } else {
      listRef.current?.focus({ preventScroll: true });
    }
  }, [decisions.length, focusId]);

  const approvable = decisions.filter(isApprovable);
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (decisions.length === 0) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Typing in an answer field or the draft editor must never be hijacked.
    if (
      e.target instanceof HTMLElement &&
      (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
    ) {
      if (e.key === "Escape") {
        e.preventDefault();
        cardRefs.current.get(decisions[activeIndex]?.id ?? "")?.focusCard();
      }
      return;
    }
    // A focused button handles Enter/Space itself (it is a click).
    if (
      e.target instanceof HTMLElement &&
      e.target.tagName === "BUTTON" &&
      (e.key === "Enter" || e.key === " ")
    ) {
      return;
    }
    const active = decisions[activeIndex];
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(decisions.length - 1, Math.max(0, i + 1)));
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if ((e.key === "Enter" || e.key === "e") && active) {
      e.preventDefault();
      cardRefs.current.get(active.id)?.focusInput();
    } else if (e.key === "d" && active) {
      e.preventDefault();
      cardRefs.current.get(active.id)?.dismiss();
    } else if (e.key === "x" && active && isApprovable(active)) {
      e.preventDefault();
      toggleSelected(active.id);
    } else if (/^[1-4]$/.test(e.key) && active) {
      const picked = cardRefs.current.get(active.id)?.pickOption(Number(e.key) - 1);
      if (picked) e.preventDefault();
    }
  };

  React.useEffect(() => {
    if (activeIndex < 0) return;
    const id = decisions[activeIndex]?.id;
    if (!id) return;
    const current = document.activeElement;
    // Only move focus when it is already in the list (keyboard navigation),
    // never while the user is typing in a card's input.
    if (current && current !== document.body && !(listRef.current?.contains(current) ?? false)) {
      return;
    }
    if (
      current instanceof HTMLElement &&
      (current.tagName === "INPUT" || current.tagName === "TEXTAREA")
    ) {
      return;
    }
    cardRefs.current.get(id)?.focusCard();
  }, [activeIndex, decisions]);

  if (decisions.length === 0) {
    return (
      <div ref={listRef} tabIndex={-1} className="focus:outline-none">
        {emptyState}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {approvable.length >= 2 ? (
        <BatchBar
          approvable={approvable}
          selected={selected}
          onSelectAll={() => setSelected(new Set(approvable.map((d) => d.id)))}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        aria-label="Decisions"
        aria-multiselectable={approvable.length >= 2 || undefined}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) listRef.current?.focus();
        }}
        className="flex flex-col gap-3 focus:outline-none"
      >
        {decisions.map((decision, i) => (
          <DecisionCard
            key={decision.id}
            ref={(handle) => {
              if (handle) cardRefs.current.set(decision.id, handle);
              else cardRefs.current.delete(decision.id);
            }}
            decision={decision}
            task={decision.taskId ? tasks[decision.taskId] : undefined}
            active={i === activeIndex}
            selectable={approvable.length >= 2 && isApprovable(decision)}
            selected={selected.has(decision.id)}
            onToggleSelect={() => toggleSelected(decision.id)}
            onActivate={() => setActiveIndex(i)}
          />
        ))}
        <KeyboardHint hasApprovals={approvable.length > 0} />
      </div>
    </div>
  );
}

/** How long "Confirm: approve N" stays armed before it falls back to "Approve N". */
const BATCH_ARM_MS = 20_000;

/**
 * Sticky bar for approving several items at once. "Approve N" asks for a
 * second click rather than a modal: enough friction before a batch of
 * side effects, no interruption for one.
 */
function BatchBar({
  approvable,
  selected,
  onSelectAll,
  onClear,
}: {
  approvable: Decision[];
  selected: ReadonlySet<string>;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const approveMany = useDecisionsStore((s) => s.approveMany);
  const [arming, setArming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const count = selected.size;

  // Armed long enough for a careful (or assistive-tech) second click; a
  // change in the selection disarms it, so the count can never be stale.
  React.useEffect(() => {
    if (!arming) return;
    const t = setTimeout(() => setArming(false), BATCH_ARM_MS);
    return () => clearTimeout(t);
  }, [arming]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: disarm whenever the selection changes.
  React.useEffect(() => {
    setArming(false);
  }, [count]);

  const run = async () => {
    if (!arming) {
      setArming(true);
      return;
    }
    setArming(false);
    setBusy(true);
    const ids = approvable.filter((d) => selected.has(d.id)).map((d) => d.id);
    const results = await approveMany(ids);
    setBusy(false);
    const ok = results.filter((r) => r.result.ok).length;
    const failed = results.length - ok;
    toast(
      failed === 0
        ? `Approved ${ok} ${ok === 1 ? "item" : "items"}.`
        : `Approved ${ok}; ${failed} could not be approved and ${failed === 1 ? "is" : "are"} still open.`,
    );
    onClear();
  };

  return (
    <div
      data-testid="batch-bar"
      className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)]/95 px-3 py-2 backdrop-blur"
    >
      <span className="text-[12.5px] text-[var(--fg-muted)]">
        {count === 0
          ? `${approvable.length} items can be approved together`
          : `${count} of ${approvable.length} selected`}
        <Kbd className="ml-2 hidden sm:inline-flex !h-4 min-w-[16px] text-[9.5px]">x</Kbd>
      </span>
      <div className="flex items-center gap-1.5">
        {count < approvable.length ? (
          <Button type="button" size="sm" variant="ghost" onClick={onSelectAll} disabled={busy}>
            Select all
          </Button>
        ) : null}
        {count > 0 ? (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={onClear} disabled={busy}>
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              variant={arming ? "primary" : "secondary"}
              onClick={() => void run()}
              disabled={busy}
              data-testid="batch-approve"
              aria-live="polite"
            >
              <CheckCheck size={13} />
              {arming ? `Confirm: approve ${count}` : `Approve ${count}`}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

interface DecisionCardHandle {
  focusCard(): void;
  focusInput(): void;
  scrollIntoView(): void;
  dismiss(): void;
  /** True when the index named an option. */
  pickOption(index: number): boolean;
}

const DecisionCard = React.forwardRef<
  DecisionCardHandle,
  {
    decision: Decision;
    task: DecisionTaskSummary | undefined;
    active: boolean;
    selectable: boolean;
    selected: boolean;
    onToggleSelect: () => void;
    onActivate: () => void;
  }
>(function DecisionCard(
  { decision, task, active, selectable, selected, onToggleSelect, onActivate },
  ref,
) {
  const { openDetail } = useFrame();
  const answer = useDecisionsStore((s) => s.answer);
  const dismiss = useDecisionsStore((s) => s.dismiss);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const draftRef = React.useRef<DraftReviewHandle>(null);
  const approvalRef = React.useRef<ApprovalHandle>(null);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState<"answer" | "dismiss" | null>(null);

  const payload = decision.payload;
  const question = payload.kind === "clarifying_question" ? payload.question : null;
  const proposal = payload.kind === "memory_proposal" ? payload : null;
  const approval = payload.kind === "approval" ? payload : null;
  const review = payload.kind === "draft_review" ? payload : null;
  // Digit keys: a memory proposal has one affirmative option, so `1`
  // confirms it; an approval or a draft review is approved with `1` and
  // (for a plain gate) rejected with `2`; a question offers its own options.
  const options =
    payload.kind === "clarifying_question"
      ? payload.options
      : proposal
        ? [REMEMBER_OPTION]
        : review
          ? [APPROVE_OPTION]
          : approval
            ? approval.reason === "ask_first"
              ? [APPROVE_OPTION, REJECT_OPTION]
              : approval.options.filter((o) => o !== REJECT_OPTION)
            : [];
  const title = task?.title ?? (proposal ? "Something Sifty noticed" : "A task");

  const toastFor = React.useCallback(
    (result: Extract<AnswerOutcome, { ok: true }>) => {
      if (result.mode === "remembered")
        return "Remembered — Sifty will use it from the next sift on.";
      if (result.mode === "resumed" || result.mode === "resifted") {
        return `Answered — Sifty is re-sifting “${title}”`;
      }
      if (result.mode === "execution") {
        switch (result.execution?.mode) {
          case "approved":
            return `Approved — Sifty is working on “${title}”`;
          case "accepted":
            return `Approved — “${title}” is done`;
          case "edited":
            return `Approved with your edits — “${title}” is done`;
          case "answered":
            return `Answered — Sifty is continuing on “${title}”`;
          case "rejected":
            return `Rejected — Sifty stopped on “${title}”`;
          case "stale":
            return "That one had already moved on.";
          default:
            return "Done";
        }
      }
      return "Answered";
    },
    [title],
  );

  const submit = React.useCallback(
    async (input: { text?: string; option?: string; draft?: ExecutionDraft | null }) => {
      if (busy) return;
      setBusy("answer");
      const result = await answer(decision.id, {
        text: input.text?.trim() || null,
        option: input.option ?? null,
        draft: input.draft ?? null,
      });
      setBusy(null);
      if (!result.ok) {
        toast(result.error);
        return;
      }
      toast(toastFor(result));
    },
    [answer, busy, decision.id, toastFor],
  );

  const runDismiss = React.useCallback(async () => {
    if (busy) return;
    setBusy("dismiss");
    const result = await dismiss(decision.id);
    setBusy(null);
    if (!result.ok) {
      toast(result.error);
      return;
    }
    toast(
      proposal
        ? "Noted — Sifty won't suggest that again."
        : approval || review
          ? `Rejected — Sifty stopped on “${title}”.`
          : `Sifty kept its own read of “${title}”. Re-sift the task anytime.`,
    );
  }, [approval, busy, decision.id, dismiss, proposal, review, title]);

  React.useImperativeHandle(
    ref,
    () => ({
      focusCard: () => cardRef.current?.focus({ preventScroll: true }),
      focusInput: () => {
        if (review) draftRef.current?.edit();
        else if (approval) approvalRef.current?.focusInput();
        else inputRef.current?.focus();
      },
      scrollIntoView: () => cardRef.current?.scrollIntoView?.({ block: "center" }),
      dismiss: () => void runDismiss(),
      pickOption: (index) => {
        const option = options[index];
        if (!option) return false;
        if (option === REJECT_OPTION) void runDismiss();
        else if (review && option === APPROVE_OPTION)
          void submit({ option, draft: draftRef.current?.pendingDraft() ?? null });
        else void submit({ option });
        return true;
      },
    }),
    [approval, options, review, runDismiss, submit],
  );

  return (
    <div
      ref={cardRef}
      role="option"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-testid="decision-card"
      data-decision-id={decision.id}
      data-decision-kind={decision.kind}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onActivate();
      }}
      onPointerDown={onActivate}
      className={cn(
        "group rounded-[var(--radius-lg)] border bg-[var(--surface)] px-4 py-3.5 sm:px-5 sm:py-4",
        "transition-[border-color,box-shadow] duration-150 ease-[var(--ease-product)]",
        "focus:outline-none",
        active
          ? "border-[var(--border-focus)] shadow-[0_0_0_1px_var(--border-focus)]"
          : "border-[var(--border)]",
        selected && "bg-[var(--accent-soft)]/40",
        busy && "opacity-60 pointer-events-none",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {selectable ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              aria-label={`Select “${title}” for batch approval`}
              data-testid="decision-select"
              className="size-3.5 shrink-0 accent-[var(--accent)]"
            />
          ) : null}
          <button
            type="button"
            onClick={() => decision.taskId && openDetail(decision.taskId)}
            disabled={!decision.taskId}
            className="group/title min-w-0 text-left text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)] inline-flex items-center gap-1 disabled:hover:text-[var(--fg-muted)]"
          >
            <span className="truncate">{title}</span>
            <ArrowUpRight
              size={12}
              className="shrink-0 opacity-0 group-hover/title:opacity-100 transition-opacity"
            />
          </button>
        </div>
        <span className="shrink-0 text-[11.5px] text-[var(--fg-subtle)] tabular-nums">
          {formatTimeAgo(decision.createdAt)}
        </span>
      </div>

      {approval ? (
        <ApprovalBody
          ref={approvalRef}
          decision={decision}
          payload={approval}
          active={active}
          busy={!!busy}
          onAnswer={(input) => void submit(input)}
          onReject={() => void runDismiss()}
        />
      ) : null}

      {review ? (
        <DraftReviewBody
          ref={draftRef}
          decision={decision}
          payload={review}
          active={active}
          busy={!!busy}
          onApprove={(draft) => void submit({ option: APPROVE_OPTION, draft })}
          onReject={() => void runDismiss()}
        />
      ) : null}

      {proposal ? (
        <>
          <div className="mt-2 flex items-start gap-2">
            <Sparkles size={14} className="mt-[3px] shrink-0 text-[var(--accent)]" />
            <div className="min-w-0">
              <p className="text-eyebrow !text-[var(--ai)]">Remember this?</p>
              <p
                className="mt-1 text-[15px] leading-[1.45] text-[var(--fg)] tracking-[-0.005em]"
                data-testid="memory-proposal-text"
              >
                {proposal.text}
              </p>
              {proposal.rationale ? (
                <p className="mt-1 text-[12.5px] leading-[1.5] text-[var(--fg-muted)]">
                  From: “{proposal.rationale}”
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={() => void submit({ option: REMEMBER_OPTION })}
              disabled={!!busy}
              data-testid="memory-proposal-remember"
            >
              <Check size={13} />
              Remember
              {active ? (
                <Kbd className="hidden sm:inline-flex !h-4 min-w-[16px] text-[9.5px]">1</Kbd>
              ) : null}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void runDismiss()}
              disabled={!!busy}
              className="text-[var(--fg-muted)]"
              data-testid="memory-proposal-dismiss"
            >
              Not this
            </Button>
          </div>
        </>
      ) : null}

      {question !== null ? (
        <>
          <div className="mt-2 flex items-start gap-2">
            <Sparkles size={14} className="mt-[3px] shrink-0 text-[var(--accent)]" />
            <p className="text-[15px] leading-[1.45] text-[var(--fg)] tracking-[-0.005em]">
              {question || "Sifty needs your input."}
            </p>
          </div>

          {options.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Suggested answers">
              {options.map((option, i) => (
                <button
                  key={option}
                  type="button"
                  tabIndex={-1}
                  onClick={() => void submit({ option })}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border-strong)]",
                    "bg-[var(--surface)] px-3 text-[13px] text-[var(--fg)]",
                    "hover:bg-[var(--surface-hover)] hover:border-[var(--border-focus)]",
                    "active:translate-y-[0.5px] transition-colors",
                  )}
                >
                  {option}
                  {active ? (
                    <Kbd className="hidden sm:inline-flex !h-4 min-w-[16px] text-[9.5px]">
                      {i + 1}
                    </Kbd>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              void submit({ text });
              setText("");
            }}
          >
            <Input
              ref={inputRef}
              value={text}
              maxLength={DECISION_LIMITS.answerText}
              onChange={(e) => setText(e.target.value)}
              placeholder={options.length ? "Or type an answer…" : "Type an answer…"}
              aria-label="Your answer"
              className="h-9 flex-1 text-[13.5px]"
            />
            <div className="flex items-center gap-1.5 justify-end">
              <Button type="submit" size="sm" variant="primary" disabled={!text.trim() || !!busy}>
                <Check size={13} />
                Answer
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void runDismiss()}
                disabled={!!busy}
                className="text-[var(--fg-muted)]"
              >
                Let Sifty decide
              </Button>
            </div>
          </form>
        </>
      ) : null}
    </div>
  );
});

function KeyboardHint({ hasApprovals }: { hasApprovals: boolean }) {
  return (
    <div className="hidden sm:flex flex-wrap items-center gap-3 px-1 pt-1 text-[11.5px] text-[var(--fg-subtle)]">
      <span className="inline-flex items-center gap-1">
        <Kbd>j</Kbd>
        <Kbd>k</Kbd> move
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>↵</Kbd> {hasApprovals ? "answer or edit" : "type an answer"}
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>1</Kbd>–<Kbd>4</Kbd> pick an option
      </span>
      {hasApprovals ? (
        <span className="inline-flex items-center gap-1">
          <Kbd>x</Kbd> select
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1">
        <Kbd>d</Kbd> {hasApprovals ? "reject / let Sifty decide" : "let Sifty decide"}
      </span>
    </div>
  );
}
