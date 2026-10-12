"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { Label, Task } from "@/lib/domain/types";
import { FREE_SIFTS_PER_DAY, TRIAL_DAYS } from "@/lib/entitlements/entitlements";
import { EXAMPLE_LABEL_NAME } from "@/lib/onboarding/starter-tasks";
import { useStore } from "@/lib/store/store";
import { Sparkles, X } from "lucide-react";
import * as React from "react";

/**
 * First-run welcome. Shows only while the workspace holds nothing but the
 * example tasks and the card has not been closed on this device: the moment
 * the user captures something of their own, their task is the story and
 * the card steps aside. Plain language, the free cap stated up front, and
 * two exits (remove the examples, close the card) so nothing feels imposed.
 */

export function exampleLabelId(labels: readonly Label[]): string | null {
  return labels.find((l) => l.name.toLowerCase() === EXAMPLE_LABEL_NAME.toLowerCase())?.id ?? null;
}

export function isExampleTask(task: Task, exampleId: string | null): boolean {
  return !!exampleId && task.labelIds.includes(exampleId);
}

export function shouldShowWelcome(args: {
  hydrated: boolean;
  dismissed: boolean;
  tasks: readonly Task[];
  labels: readonly Label[];
}): boolean {
  if (!args.hydrated || args.dismissed || args.tasks.length === 0) return false;
  const exampleId = exampleLabelId(args.labels);
  return args.tasks.every((t) => isExampleTask(t, exampleId));
}

export function WelcomeCard() {
  const { openCapture } = useFrame();
  const hydrated = useStore((s) => s.hydrated);
  const dismissed = useStore((s) => s.welcomeDismissed);
  const dismissWelcome = useStore((s) => s.dismissWelcome);
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const deleteTask = useStore((s) => s.deleteTask);

  if (!shouldShowWelcome({ hydrated, dismissed, tasks, labels })) return null;

  const removeExamples = () => {
    const exampleId = exampleLabelId(labels);
    for (const t of tasks) if (isExampleTask(t, exampleId)) deleteTask(t.id);
  };

  return (
    <section
      aria-labelledby="welcome-title"
      data-testid="welcome-card"
      className="relative mb-6 rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-elevated)] px-5 py-4 shadow-sm animate-fade-in"
    >
      <button
        type="button"
        onClick={dismissWelcome}
        aria-label="Dismiss welcome"
        className="absolute right-3 top-3 rounded-full p-1 text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
      >
        <X size={14} />
      </button>

      <div className="flex items-center gap-2 text-[var(--ai)]">
        <Sparkles size={13} />
        <span className="text-eyebrow !text-[var(--ai)]">Welcome</span>
      </div>
      <h2
        id="welcome-title"
        className="mt-1.5 text-[16px] font-medium tracking-[-0.01em] text-[var(--fg)]"
      >
        Three example tasks, already sifted.
      </h2>
      <p className="mt-1.5 max-w-prose text-[13.5px] leading-[1.55] text-[var(--fg-muted)]">
        Capture anything in your own words — press <Kbd>C</Kbd>. Sifty sifts it into a clear title,
        the next step, priority, effort, labels, and subtasks. Every field stays editable, and the
        sheet shows why it decided what it did.
      </p>
      <p className="mt-1.5 max-w-prose text-[13px] leading-[1.55] text-[var(--fg-muted)]">
        Capture is unlimited. Free accounts get {FREE_SIFTS_PER_DAY} sifts a day; your first{" "}
        {TRIAL_DAYS} days include unlimited sifting.
      </p>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={openCapture}>
          Capture your first task
        </Button>
        <Button variant="ghost" size="sm" onClick={removeExamples}>
          Remove the examples
        </Button>
      </div>
    </section>
  );
}
