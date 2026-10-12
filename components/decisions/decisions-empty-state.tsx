"use client";

import { Brain, CheckCheck, Sparkles } from "lucide-react";
import * as React from "react";

/**
 * Empty inbox. An empty Decisions view is good news, so the headline says
 * so, and the three lines explain what will arrive here so the view is
 * understood before it is ever needed.
 */
export function DecisionsEmptyState() {
  return (
    <div
      data-testid="decisions-empty"
      className="rounded-[var(--radius-xl)] border border-dashed border-[var(--border-strong)] bg-[var(--surface-muted)]/40 px-6 py-10 text-center"
    >
      <div className="mx-auto inline-flex size-9 items-center justify-center rounded-full bg-[var(--ai-soft)] text-[var(--ai)]">
        <CheckCheck size={16} />
      </div>
      <p className="mt-3 text-[15px] text-[var(--fg)] tracking-[-0.01em]">
        Nothing waiting on you.
      </p>
      <p className="mt-1.5 mx-auto max-w-prose text-[13px] leading-[1.5] text-[var(--fg-muted)]">
        Sifty only interrupts when a guess would be worse than a question.
      </p>
      <ul className="mx-auto mt-5 flex max-w-[440px] flex-col gap-2.5 text-left text-[13px] text-[var(--fg-muted)]">
        <li className="flex items-start gap-2.5">
          <Sparkles size={13} className="mt-[3px] shrink-0 text-[var(--accent)]" />
          <span>
            <span className="text-[var(--fg)]">Clarifying questions</span> — when a sift is unsure
            what you meant, one short question shows up here instead of a wrong guess.
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <Brain size={13} className="mt-[3px] shrink-0 text-[var(--ai)]" />
          <span>
            <span className="text-[var(--fg)]">Memory suggestions</span> — preferences Sifty notices
            in your edits, for you to keep or drop.
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <CheckCheck size={13} className="mt-[3px] shrink-0 text-[var(--done)]" />
          <span>
            <span className="text-[var(--fg)]">Approvals</span> — drafts and actions an agent
            prepared, waiting for your go-ahead.
          </span>
        </li>
      </ul>
    </div>
  );
}
