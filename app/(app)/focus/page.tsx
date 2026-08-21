"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import { selectFocusTasks } from "@/lib/store/selectors";
import { useTaskViewMode } from "@/lib/store/view-mode";

export default function FocusPage() {
  const { mode: viewMode, setMode: setViewMode, ready: viewReady } = useTaskViewMode();
  return (
    <PageShell title="Focus" width={viewReady && viewMode === "board" ? "wide" : "default"}>
      <TaskView
        title="Focus"
        description="Work you've committed to, sorted by Sifty's read on what to do next. Sliding the priority moves things; letting AI re-triage rebalances."
        selector={selectFocusTasks}
        emptyTitle="Nothing in Focus."
        emptyDescription="Move tasks here from Inbox when you're ready to commit to them."
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        viewReady={viewReady}
      />
    </PageShell>
  );
}
