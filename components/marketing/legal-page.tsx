import { AlertTriangle } from "lucide-react";
import * as React from "react";

/**
 * Shared frame for /privacy and /terms: title, last-updated line, a draft
 * notice (the copy is a starting point for Santi's review, not reviewed
 * legal text), and a readable prose column.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-6 sm:py-16">
      <div className="text-eyebrow mb-4">Legal</div>
      <h1 className="text-display text-[36px] sm:text-[44px] text-[var(--fg)]">{title}</h1>
      <p className="mt-3 text-[13.5px] text-[var(--fg-subtle)]">
        Last updated <time dateTime={updated}>{formatDate(updated)}</time>
      </p>

      <div
        role="note"
        className="mt-6 flex gap-3 rounded-[var(--radius-lg)] border border-[var(--accent)]/40 bg-[var(--accent-soft)]/40 p-4 text-[13.5px] leading-[1.5] text-[var(--fg)]"
      >
        <AlertTriangle size={16} className="mt-[2px] shrink-0 text-[var(--accent)]" aria-hidden />
        <p>
          <strong className="font-medium">Draft.</strong> This document is a plain-language starting
          point awaiting review by Waimaka, Inc. It describes how Sifty actually works today, but it
          has not yet been reviewed by a lawyer and may change before launch.
        </p>
      </div>

      <div className="legal-prose mt-10">{children}</div>
    </article>
  );
}

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mt-9 first:mt-0">
      <h2 id={`${id}-heading`} className="text-[20px] text-[var(--fg)]">
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-[15px] leading-[1.6] text-[var(--fg-muted)]">
        {children}
      </div>
    </section>
  );
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
