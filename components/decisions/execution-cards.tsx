"use client";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { DECISION_LIMITS } from "@/lib/domain/limits";
import type {
  ApprovalPayload,
  Decision,
  DraftReviewPayload,
  ExecutionDraft,
} from "@/lib/domain/types";
import { formatCents } from "@/lib/entitlements/entitlements";
import { APPROVE_OPTION, REJECT_OPTION, executorLabel } from "@/lib/executions/copy";
import { cn } from "@/lib/utils/cn";
import { type DiffLine, diffLines, diffStats } from "@/lib/utils/diff";
import { Bot, Check, ChevronDown, Pencil, X } from "lucide-react";
import * as React from "react";

/**
 * Card bodies for the two execution decisions.
 *
 * Approval (`ask_first`): one sentence on what Sifty wants to do, one
 * primary action. A question from the executor renders its options plus
 * free text, like a clarifying question.
 *
 * Draft review: the draft itself is the content (progressive disclosure —
 * a long draft starts collapsed), with **Approve** as the one primary
 * action, **Edit** as the reversible detour, and **Reject** always visible
 * but quiet. Editing shows a line diff before the approval so the user
 * sees exactly what they are about to sign off (feedforward).
 */

const PREVIEW_LINES = 8;

export interface ApprovalHandle {
  /** Focus the free-text field of an executor question (no-op for a plain gate). */
  focusInput(): void;
}

export const ApprovalBody = React.forwardRef<
  ApprovalHandle,
  {
    decision: Decision;
    payload: ApprovalPayload;
    active: boolean;
    busy: boolean;
    onAnswer: (input: { option?: string; text?: string }) => void;
    onReject: () => void;
  }
>(function ApprovalBody({ payload, active, busy, onAnswer, onReject }, ref) {
  const [text, setText] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isQuestion = payload.reason === "question";
  const options = isQuestion ? payload.options.filter((o) => o !== REJECT_OPTION) : [];
  React.useImperativeHandle(ref, () => ({ focusInput: () => inputRef.current?.focus() }), []);

  return (
    <>
      <div className="mt-2 flex items-start gap-2">
        <Bot size={14} className="mt-[3px] shrink-0 text-[var(--accent)]" />
        <div className="min-w-0 flex-1">
          <p className="text-eyebrow !text-[var(--accent)]">
            {isQuestion ? `${executorLabel(payload.executor)} asks` : "Sifty wants to"}
          </p>
          <p
            className="mt-1 text-[15px] leading-[1.45] text-[var(--fg)] tracking-[-0.005em]"
            data-testid="approval-question"
          >
            {isQuestion ? payload.question : payload.action}
          </p>
          {!isQuestion ? (
            <p className="mt-1 text-[12.5px] leading-[1.5] text-[var(--fg-muted)]">
              Nothing happens until you say so. Estimated {formatCents(payload.estimateCents)}.
            </p>
          ) : null}
        </div>
      </div>

      {isQuestion ? (
        <>
          {options.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Suggested answers">
              {options.map((option, i) => (
                <button
                  key={option}
                  type="button"
                  tabIndex={-1}
                  disabled={busy}
                  onClick={() => onAnswer({ option })}
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
              onAnswer({ text });
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
            <div className="flex items-center justify-end gap-1.5">
              <Button type="submit" size="sm" variant="primary" disabled={!text.trim() || busy}>
                <Check size={13} />
                Answer
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onReject}
                disabled={busy}
                className="text-[var(--fg-muted)]"
              >
                Stop this
              </Button>
            </div>
          </form>
        </>
      ) : (
        <div className="mt-3 flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={() => onAnswer({ option: APPROVE_OPTION })}
            disabled={busy}
            data-testid="approval-approve"
          >
            <Check size={13} />
            Approve
            {active ? (
              <Kbd className="hidden sm:inline-flex !h-4 min-w-[16px] text-[9.5px]">1</Kbd>
            ) : null}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onReject}
            disabled={busy}
            className="text-[var(--fg-muted)]"
            data-testid="approval-reject"
          >
            <X size={13} />
            Reject
          </Button>
        </div>
      )}
    </>
  );
});

export interface DraftReviewHandle {
  /** Enter edit mode (the `e` / `Enter` key). */
  edit(): void;
  /** The edited draft when the editor has changes, else null. */
  pendingDraft(): ExecutionDraft | null;
}

export const DraftReviewBody = React.forwardRef<
  DraftReviewHandle,
  {
    decision: Decision;
    payload: DraftReviewPayload;
    active: boolean;
    busy: boolean;
    onApprove: (draft: ExecutionDraft | null) => void;
    onReject: () => void;
  }
>(function DraftReviewBody({ payload, active, busy, onApprove, onReject }, ref) {
  const [editing, setEditing] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [showDiff, setShowDiff] = React.useState(true);
  const [title, setTitle] = React.useState(payload.draft.title ?? "");
  const [body, setBody] = React.useState(payload.draft.body);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  const lines = payload.draft.body.split("\n");
  const long = lines.length > PREVIEW_LINES;
  const preview = expanded || !long ? payload.draft.body : lines.slice(0, PREVIEW_LINES).join("\n");

  const edited: ExecutionDraft = {
    title: title.trim() || null,
    body,
    format: payload.draft.format,
  };
  const changed =
    body.trim() !== payload.draft.body.trim() ||
    (title.trim() || null) !== (payload.draft.title ?? null);

  React.useImperativeHandle(
    ref,
    () => ({
      edit: () => {
        setEditing(true);
        setTimeout(() => bodyRef.current?.focus(), 0);
      },
      pendingDraft: () =>
        editing && changed
          ? { title: title.trim() || null, body, format: payload.draft.format }
          : null,
    }),
    [editing, changed, title, body, payload.draft.format],
  );
  const diff = React.useMemo(
    () => (editing && changed ? diffLines(payload.draft.body, body) : []),
    [editing, changed, payload.draft.body, body],
  );
  const stats = diffStats(diff);

  return (
    <>
      <div className="mt-2 flex items-start gap-2">
        <Bot size={14} className="mt-[3px] shrink-0 text-[var(--accent)]" />
        <div className="min-w-0 flex-1">
          <p className="text-eyebrow !text-[var(--accent)]">Draft ready</p>
          <p
            className="mt-1 text-[15px] leading-[1.45] text-[var(--fg)] tracking-[-0.005em]"
            data-testid="draft-summary"
          >
            {payload.summary}
          </p>
        </div>
      </div>

      {editing ? (
        <div className="mt-3 flex flex-col gap-2" data-testid="draft-editor">
          <Input
            value={title}
            maxLength={DECISION_LIMITS.draftTitle}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            aria-label="Draft title"
            className="h-9 text-[13.5px]"
          />
          <Textarea
            ref={bodyRef}
            value={body}
            maxLength={DECISION_LIMITS.draftBody}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.min(18, Math.max(6, body.split("\n").length + 1))}
            aria-label="Draft body"
            className="font-mono text-[12.5px] leading-[1.55]"
          />
          {changed ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)]/60">
              <button
                type="button"
                onClick={() => setShowDiff((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
                aria-expanded={showDiff}
              >
                <span>
                  Your changes <span className="text-num text-[var(--done)]">+{stats.added}</span>{" "}
                  <span className="text-num text-[var(--warn)]">−{stats.removed}</span>
                </span>
                <ChevronDown
                  size={13}
                  className={cn("transition-transform duration-200", showDiff && "rotate-180")}
                />
              </button>
              {showDiff ? <DiffView lines={diff} /> : null}
            </div>
          ) : (
            <p className="px-1 text-[12px] text-[var(--fg-subtle)]">No changes yet.</p>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)]/60 px-3.5 py-3">
          {payload.draft.title ? (
            <p className="text-[13px] font-medium text-[var(--fg)]">{payload.draft.title}</p>
          ) : null}
          <pre
            data-testid="draft-body"
            className={cn(
              "whitespace-pre-wrap font-sans text-[13px] leading-[1.55] text-[var(--fg-muted)]",
              payload.draft.title && "mt-1.5",
            )}
          >
            {preview}
            {long && !expanded ? "\n…" : ""}
          </pre>
          {long ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-[12px] text-[var(--fg-muted)] underline-offset-2 hover:text-[var(--fg)] hover:underline"
            >
              {expanded ? "Show less" : `Show the full draft (${lines.length} lines)`}
            </button>
          ) : null}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {editing ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={() => onApprove(changed ? edited : null)}
              disabled={busy || !body.trim()}
              data-testid="draft-approve-edits"
            >
              <Check size={13} />
              {changed ? "Approve with edits" : "Approve as is"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setTitle(payload.draft.title ?? "");
                setBody(payload.draft.body);
              }}
              disabled={busy}
              className="text-[var(--fg-muted)]"
            >
              Discard edits
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={() => onApprove(null)}
              disabled={busy}
              data-testid="draft-approve"
            >
              <Check size={13} />
              Approve
              {active ? (
                <Kbd className="hidden sm:inline-flex !h-4 min-w-[16px] text-[9.5px]">1</Kbd>
              ) : null}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing(true);
                setTimeout(() => bodyRef.current?.focus(), 0);
              }}
              disabled={busy}
              data-testid="draft-edit"
            >
              <Pencil size={13} />
              Edit
              {active ? (
                <Kbd className="hidden sm:inline-flex !h-4 min-w-[16px] text-[9.5px]">e</Kbd>
              ) : null}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onReject}
              disabled={busy}
              className="text-[var(--fg-muted)]"
              data-testid="draft-reject"
            >
              <X size={13} />
              Reject
            </Button>
          </>
        )}
      </div>
    </>
  );
});

/** Line diff, unified: removed lines first where they were, added lines after. */
export function DiffView({ lines }: { lines: readonly DiffLine[] }) {
  return (
    <pre
      data-testid="draft-diff"
      className="max-h-72 overflow-auto border-t border-[var(--border)] px-2 py-2 font-mono text-[12px] leading-[1.55]"
    >
      {lines.map((line, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity beyond position.
          key={i}
          className={cn(
            "block whitespace-pre-wrap rounded-[3px] px-1.5",
            line.op === "add" && "bg-[var(--done)]/12 text-[var(--fg)]",
            line.op === "remove" && "bg-[var(--warn)]/12 text-[var(--fg-muted)] line-through",
            line.op === "equal" && "text-[var(--fg-subtle)]",
          )}
        >
          <span className="mr-2 inline-block w-3 select-none text-[var(--fg-subtle)]">
            {line.op === "add" ? "+" : line.op === "remove" ? "−" : " "}
          </span>
          {line.text || " "}
        </span>
      ))}
    </pre>
  );
}
