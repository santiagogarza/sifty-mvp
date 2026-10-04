"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { runTriage } from "@/lib/ai/run-triage";
import { TASK_LIMITS } from "@/lib/domain/limits";
import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { ArrowUpRight, Sparkles } from "lucide-react";
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
 */

export function CaptureDialog({
  open,
  onOpenChange,
  fileTo = null,
  dueToday = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /**
   * Column the board's Add row captured from. The task is still created as
   * inbox — new captures always start there — and then filed, as a user
   * action, into this status.
   */
  fileTo?: Lifecycle | null;
  /** Set when capturing from the Today board, so the Today lens keeps the task. */
  dueToday?: boolean;
}) {
  const { openDetail } = useFrame();
  const createTask = useStore((s) => s.createTask);
  const updateTask = useStore((s) => s.updateTask);
  const setLifecycle = useStore((s) => s.setLifecycle);
  const [text, setText] = React.useState("");
  const [context, setContext] = React.useState("");
  const [showContext, setShowContext] = React.useState(false);
  const textRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (!open) {
      setText("");
      setContext("");
      setShowContext(false);
    } else {
      requestAnimationFrame(() => textRef.current?.focus());
    }
  }, [open]);

  const submit = () => {
    if (!text.trim()) return;
    const task = createTask({
      sourceText: text,
      sourceContext: context.trim() || null,
    });
    if (dueToday) updateTask(task.id, { due: new Date().toISOString().slice(0, 10) }, { editedFields: ["due"] });
    if (fileTo && fileTo !== "inbox") setLifecycle(task.id, fileTo);
    onOpenChange(false);
    // Open the sheet on the next frame so this dialog's close (and its
    // focus restore) doesn't fight the sheet's focus trap.
    requestAnimationFrame(() => openDetail(task.id));
    queueMicrotask(() => runTriage(task.id));
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
            {fileTo && fileTo !== "inbox"
              ? `Files to ${statusLabel(fileTo)}. Sifty organizes it.`
              : "Type the task as you'd say it. Sifty organizes it."}
          </DialogDescription>
        </div>

        <div className="px-5 pb-2">
          <Textarea
            ref={textRef}
            placeholder="What do you need to do?"
            value={text}
            maxLength={TASK_LIMITS.sourceText}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            className="text-[15px] leading-[1.55] border-transparent bg-[var(--surface-muted)] px-3.5 py-3 focus:border-transparent"
          />
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
