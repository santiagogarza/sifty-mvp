"use client";

import * as React from "react";

/**
 * Page header used inside (app)/* routes.
 *
 * The display title uses our serif face — once. Setting expectation: this
 * is a thoughtful surface, not just a list of rows.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mt-6 mb-5">
      <div className="min-w-0">
        {eyebrow ? <div className="text-eyebrow mb-1.5">{eyebrow}</div> : null}
        <h1 className="text-display text-[34px] sm:text-[36px] text-[var(--fg)]">{title}</h1>
        {description ? (
          <p className="text-[14px] text-[var(--fg-muted)] leading-[1.5] mt-1.5 max-w-prose">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
