"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { watchSift } from "@/lib/ai/run-triage";
import { TASK_LIMITS } from "@/lib/domain/limits";
import { describeDay, parseNaturalDate, stripMatch } from "@/lib/domain/nl-date";
import { useStore } from "@/lib/store/store";
import { ArrowUpRight, CalendarDays, Sparkles, X } from "lucide-react";
import * as React from "react";

/**
 * Capture dialog.
 *
 * The capture flow is the most important interaction in the product. Goals:
 *   1. Zero friction: opens with `c` from anywhere, focuses immediately,
 *      Cmd+Enter submits.
 *   2. Instant return: the task is created synchronously and the dialog
 *      closes on submit. AI enrichment happens in the background.
 *   3. Visible landing: the task sheet opens on the new task so the user
 *      watches Sifty organize it — and can edit or file it right away.
 *      Never blocking: Esc dismisses, triage continues in the background.
 *   4. Optional context, never required: a separate "Add context" affordance
 *      reveals a second textarea so the empty state stays calm.
 *   5. Drafts survive dismissal: Escape (or any close that isn't a capture)
 *      keeps the typed text for the next open. Only a successful capture or
 *      an explicit Discard clears it. Session-only — never persisted.
 *   6. Dates are understood as you type: "call Ana tomorrow 3pm" shows a
 *      removable "Due Tue, Oct 13" chip (feedforward — the outcome is
 *      visible before Capture). Accepted, the date is stored as a user-set
 *      due the sift will not overwrite, and the phrase leaves the title.
 *      Removed, the text is captured exactly as typed.
 */

export function CaptureDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { openDetail } = useFrame();
  const createTask = useStore((s) => s.createTask);
  const [text, setText] = React.useState("");
  const [context, setContext] = React.useState("");
  const [showContext, setShowContext] = React.useState(false);
  /**
   * The date the user declined: its phrase and the day it resolved to. The
   * chip stays away while that phrase still names that day.
   */
  const [dismissed, setDismissed] = React.useState<{ phrase: string; due: string } | null>(null);
  const textRef = React.useRef<HTMLTextAreaElement>(null);

  const hasDraft = text.length > 0 || context.length > 0;

  // Re-parsed on every open as well as every keystroke: a draft kept
  // across midnight must not carry yesterday's "tomorrow".
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` is a deliberate re-parse trigger.
  const dateMatch = React.useMemo(() => parseNaturalDate(text), [text, open]);
  // Declined once, a date stays declined as its phrase grows ("tomorrow" →
  // "tomorrow 3pm"); a phrase that now names a different day ("Friday" →
  // "next Friday") is a new offer.
  const dueChip =
    dateMatch &&
    !(
      dismissed &&
      dateMatch.text.toLowerCase().includes(dismissed.phrase) &&
      dateMatch.due === dismissed.due
    )
      ? dateMatch
      : null;

  const onTextChange = (next: string) => {
    setText(next);
    // A removed chip stays removed while its phrase is still in the text;
    // once the phrase is gone (deleted, or the field retyped) a fresh
    // phrase earns a fresh chip.
    if (dismissed && !next.toLowerCase().includes(dismissed.phrase)) setDismissed(null);
  };

  const clearDraft = () => {
    setText("");
    setContext("");
    setShowContext(false);
    setDismissed(null);
  };

  React.useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      // A restored draft should read as "pick up where you left off": caret
      // at the end, not at the start of the text.
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }, [open]);

  const submit = () => {
    if (!text.trim()) return;
    // Resolve the accepted chip against the clock at the moment of capture.
    const accepted = dueChip ? parseNaturalDate(text) : null;
    const task = createTask({
      sourceText: text,
      sourceContext: context.trim() || null,
      due: accepted?.due ?? null,
      title: accepted ? stripMatch(text, accepted) : null,
    });
    clearDraft();
    onOpenChange(false);
    // Open the sheet on the next frame so this dialog's close (and its
    // focus restore) doesn't fight the sheet's focus trap.
    requestAnimationFrame(() => openDetail(task.id));
    // The create push enqueues the sift server-side; the browser only watches.
    queueMicrotask(() => watchSift(task.id));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent placement="top" className="overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-[var(--ai)]" />
            <DialogTitle>Capture</DialogTitle>
          </div>
          <DialogDescription className="hidden sm:block text-[12px]">
            Type the task as you'd say it. Sifty organizes it.
          </DialogDescription>
        </div>

        <div className="px-5 pb-2">
          <Textarea
            ref={textRef}
            placeholder="What do you need to do?"
            value={text}
            maxLength={TASK_LIMITS.sourceText}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            className="text-[15px] leading-[1.55] border-transparent bg-[var(--surface-muted)] px-3.5 py-3 focus:border-transparent"
          />
          {dueChip ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 animate-fade-in">
              <span
                data-testid="capture-due-chip"
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] pl-2.5 pr-1 text-[12.5px] text-[var(--fg)]"
              >
                <CalendarDays size={12} className="text-[var(--fg-muted)]" />
                <span>
                  Due {describeDay(dueChip.due)}
                  {dueChip.time ? (
                    <span className="text-[var(--fg-muted)]"> · {dueChip.time}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDismissed({ phrase: dueChip.text.toLowerCase(), due: dueChip.due });
                    textRef.current?.focus();
                  }}
                  aria-label="Remove due date"
                  title="Keep the date in the text instead"
                  className="flex size-5 items-center justify-center rounded-full text-[var(--fg-subtle)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
                >
                  <X size={11} />
                </button>
              </span>
              <span className="text-[11.5px] text-[var(--fg-subtle)]">from “{dueChip.text}”</span>
            </div>
          ) : null}
          {showContext ? (
            <div className="mt-2">
              <div className="text-eyebrow mb-1.5">Context</div>
              <Textarea
                placeholder="Anything Sifty should know — links, deadlines, who's involved."
                value={context}
                maxLength={TASK_LIMITS.sourceContext}
                onChange={(e) => setContext(e.target.value)}
                rows={3}
                className="text-[14px] leading-[1.55] border-transparent bg-[var(--surface-muted)]"
              />
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-3 bg-[var(--surface-muted)]">
          <button
            type="button"
            onClick={() => setShowContext((v) => !v)}
            className="text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors flex items-center gap-1.5"
          >
            <ArrowUpRight size={12} />
            {showContext ? "Hide context" : "Add context"}
          </button>
          <div className="flex items-center gap-3">
            {hasDraft ? (
              <button
                type="button"
                onClick={() => {
                  clearDraft();
                  onOpenChange(false);
                }}
                className="text-[12.5px] text-[var(--fg-subtle)] hover:text-[var(--fg)] transition-colors"
              >
                Discard
              </button>
            ) : null}
            <span className="hidden sm:flex items-center gap-1.5 text-[11.5px] text-[var(--fg-subtle)]">
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
              <span className="ml-1">to capture</span>
            </span>
            <Button variant="primary" onClick={submit} disabled={!text.trim()}>
              Capture
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
