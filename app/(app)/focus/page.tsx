"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import { selectFocusTasks } from "@/lib/store/selectors";
import { useBoardMode } from "@/lib/store/view-mode";

export default function FocusPage() {
  const [mode] = useBoardMode();
  return (
    <PageShell title="Focus" width={mode === "board" ? "wide" : "default"}>
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
