"use client";

import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { TaskBoard } from "@/components/tasks/task-board";
import { ViewSwitcher } from "@/components/tasks/view-switcher";

export default function BoardPage() {
  return (
    <PageShell title="Board" wide>
      <PageHeader
        eyebrow="All work"
        title="Board"
        description="Move tasks between columns to update their status. Drag a card, or use its arrow controls."
        actions={<ViewSwitcher />}
      />
      <TaskBoard />
    </PageShell>
  );
}
