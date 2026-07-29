"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import type { Task } from "@/lib/domain/types";
import { selectByLifecycle } from "@/lib/store/selectors";
import { useTaskViewMode } from "@/lib/store/view-mode";
import * as React from "react";

export default function SomedayPage() {
  const select = React.useCallback((t: Task[]) => selectByLifecycle(t, "someday"), []);
  const [viewMode, setViewMode] = useTaskViewMode();
  return (
    <PageShell title="Someday" width={viewMode === "board" ? "wide" : "default"}>
      <TaskView
        title="Someday"
        description="A quiet shelf for ideas that aren't urgent. Revisit when the season is right."
        selector={select}
        emptyTitle="Empty shelf."
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
    </PageShell>
  );
}
