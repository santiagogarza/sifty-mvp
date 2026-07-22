"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskBoard } from "@/components/tasks/task-board";

export default function BoardPage() {
  return (
    <PageShell title="Board" contentClassName="max-w-none">
      <TaskBoard />
    </PageShell>
  );
}
