"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { toast } from "@/components/ui/toast";
import { type DecisionTaskSummary, useDecisionsStore } from "@/lib/decisions/client";
import { REMEMBER_OPTION } from "@/lib/decisions/copy";
import { DECISION_LIMITS } from "@/lib/domain/limits";
import type { Decision } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatTimeAgo } from "@/lib/utils/dates";
import { ArrowUpRight, Check, Sparkles } from "lucide-react";
import * as React from "react";

/**
 * The Decisions inbox: everything waiting on the human, newest first.
 *
 * Each card is one decision and resolves in one gesture: tap an option,
 * or type a line and press Enter. Dismissing ("Let Sifty decide") is
 * always one click away and never hidden, so the inbox can be cleared
 * without being answered. Keyboard mirrors the task list: `j`/`k` and the
 * arrows move, `Enter` jumps into the answer field, `1`–`4` tap an option,
 * `d` dismisses, `Esc` returns to the list.
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
  const listRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef<Map<string, DecisionCardHandle>>(new Map());
  const didInitialFocus = React.useRef(false);

  React.useEffect(() => {
    if (activeIndex >= decisions.length) setActiveIndex(decisions.length - 1);
  }, [decisions.length, activeIndex]);

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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (decisions.length === 0) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Typing in the answer field must never be hijacked.
    if (e.target instanceof HTMLElement && e.target.tagName === "INPUT") {
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
    } else if (e.key === "Enter" && active) {
      e.preventDefault();
      cardRefs.current.get(active.id)?.focusInput();
    } else if (e.key === "d" && active) {
      e.preventDefault();
      cardRefs.current.get(active.id)?.dismiss();
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
    if (current instanceof HTMLElement && current.tagName === "INPUT") return;
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
    <div
      ref={listRef}
      role="listbox"
      tabIndex={0}
      aria-label="Decisions"
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
          onActivate={() => setActiveIndex(i)}
        />
      ))}
      <KeyboardHint />
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
    onActivate: () => void;
  }
>(function DecisionCard({ decision, task, active, onActivate }, ref) {
  const { openDetail } = useFrame();
  const answer = useDecisionsStore((s) => s.answer);
  const dismiss = useDecisionsStore((s) => s.dismiss);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState<"answer" | "dismiss" | null>(null);

  const payload = decision.payload;
  const question = payload.kind === "clarifying_question" ? payload.question : null;
  const proposal = payload.kind === "memory_proposal" ? payload : null;
  // A memory proposal has one affirmative option, so `1` confirms it.
  const options =
    payload.kind === "clarifying_question" ? payload.options : proposal ? [REMEMBER_OPTION] : [];
  const title = task?.title ?? (proposal ? "Something Sifty noticed" : "A task");

  const submit = React.useCallback(
    async (input: { text?: string; option?: string }) => {
      if (busy) return;
      setBusy("answer");
      const result = await answer(decision.id, {
        text: input.text?.trim() || null,
        option: input.option ?? null,
      });
      setBusy(null);
      if (!result.ok) {
        toast(result.error);
        return;
      }
      toast(
        result.mode === "remembered"
          ? "Remembered — Sifty will use it from the next sift on."
          : result.mode === "resumed" || result.mode === "resifted"
            ? `Answered — Sifty is re-sifting “${title}”`
            : "Answered",
      );
    },
    [answer, busy, decision.id, title],
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
        : `Sifty kept its own read of “${title}”. Re-sift the task anytime.`,
    );
  }, [busy, decision.id, dismiss, proposal, title]);

  React.useImperativeHandle(
    ref,
    () => ({
      focusCard: () => cardRef.current?.focus({ preventScroll: true }),
      focusInput: () => inputRef.current?.focus(),
      scrollIntoView: () => cardRef.current?.scrollIntoView?.({ block: "center" }),
      dismiss: () => void runDismiss(),
      pickOption: (index) => {
        const option = options[index];
        if (!option) return false;
        void submit({ option });
        return true;
      },
    }),
    [options, runDismiss, submit],
  );

  return (
    <div
      ref={cardRef}
      role="option"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-testid="decision-card"
      data-decision-id={decision.id}
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
        busy && "opacity-60 pointer-events-none",
      )}
    >
      <div className="flex items-start justify-between gap-3">
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
        <span className="shrink-0 text-[11.5px] text-[var(--fg-subtle)] tabular-nums">
          {formatTimeAgo(decision.createdAt)}
        </span>
      </div>

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

      {!proposal ? (
        <div className="mt-2 flex items-start gap-2">
          <Sparkles size={14} className="mt-[3px] shrink-0 text-[var(--accent)]" />
          <p className="text-[15px] leading-[1.45] text-[var(--fg)] tracking-[-0.005em]">
            {question ?? "Sifty needs your input."}
          </p>
        </div>
      ) : null}

      {!proposal && options.length > 0 ? (
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
                <Kbd className="hidden sm:inline-flex !h-4 min-w-[16px] text-[9.5px]">{i + 1}</Kbd>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {proposal ? null : (
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
      )}
    </div>
  );
});

function KeyboardHint() {
  return (
    <div className="hidden sm:flex items-center gap-3 px-1 pt-1 text-[11.5px] text-[var(--fg-subtle)]">
      <span className="inline-flex items-center gap-1">
        <Kbd>j</Kbd>
        <Kbd>k</Kbd> move
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>↵</Kbd> type an answer
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>1</Kbd>–<Kbd>4</Kbd> pick an option
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>d</Kbd> let Sifty decide
      </span>
    </div>
  );
}
