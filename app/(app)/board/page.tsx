"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskBoard } from "@/components/tasks/task-board";
import { ViewToggle } from "@/components/tasks/view-toggle";

export default function BoardPage() {
  return (
    <PageShell title="Board" rightSlot={<ViewToggle />} fluid>
      <div className="flex flex-1 min-h-0 flex-col pt-4 pb-2">
        <p className="mb-3 text-[13px] text-[var(--fg-muted)]">
          Every stage at a glance. Drag a card to another column to change its status.
        </p>
        <TaskBoard />
      </div>
    </PageShell>
  );
}
