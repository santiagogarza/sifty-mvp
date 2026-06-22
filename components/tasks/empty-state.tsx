"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Sparkles } from "lucide-react";
import * as React from "react";

/**
 * Calm empty state.
 *
 * The app's empty states should rarely be cheerleading. Most of the time the
 * absence of work is good. We show a one-line acknowledgement and a single
 * affordance — capture — because that's the only thing that should pull
 * attention.
 */
export function TaskEmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const { openCapture } = useFrame();
  return (
    <div className="rounded-[var(--radius-xl)] border border-dashed border-[var(--border-strong)] bg-[var(--surface-muted)]/40 px-6 py-10 text-center">
      <div className="mx-auto inline-flex size-9 items-center justify-center rounded-full bg-[var(--ai-soft)] text-[var(--ai)]">
        <Sparkles size={16} />
      </div>
      <p className="mt-3 text-[15px] text-[var(--fg)] tracking-[-0.01em]">{title}</p>
      {description ? (
        <p className="mt-1.5 text-[13px] text-[var(--fg-muted)] max-w-prose mx-auto leading-[1.5]">
          {description}
        </p>
      ) : null}
      <div className="mt-4 inline-flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={openCapture}>
          Capture a task
        </Button>
        <span className="hidden sm:flex items-center gap-1 text-[11px] text-[var(--fg-subtle)]">
          or press <Kbd>C</Kbd>
        </span>
      </div>
    </div>
  );
}
