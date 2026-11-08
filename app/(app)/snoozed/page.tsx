"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import { selectSnoozedTasks } from "@/lib/store/selectors";

export default function SnoozedPage() {
  return (
    <PageShell title="Snoozed">
      <TaskView
        title="Snoozed"
        description="Out of sight until their day comes. Each task returns to where it was on its wake day — soonest first."
        selector={selectSnoozedTasks}
        emptyTitle="Nothing snoozed."
        emptyDescription="Snooze a task from its row or detail panel to set it aside until a better day."
      />
    </PageShell>
  );
}
