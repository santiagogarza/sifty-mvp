"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import { useRouteViewMode } from "@/components/tasks/use-view-mode";
import { selectFocusTasks } from "@/lib/store/selectors";

export default function FocusPage() {
  const [mode] = useRouteViewMode();
  return (
    <PageShell title="Focus" wide={mode === "board"}>
      <TaskView
        title="Focus"
        description="Work you've committed to, sorted by Sifty's read on what to do next. Sliding the priority moves things; letting AI re-triage rebalances."
        selector={selectFocusTasks}
        emptyTitle="Nothing in Focus."
        emptyDescription="Move tasks here from Inbox when you're ready to commit to them."
      />
    </PageShell>
  );
}
