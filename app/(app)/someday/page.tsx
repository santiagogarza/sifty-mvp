"use client";

import { StatusPageShell } from "@/components/tasks/board/status-page-shell";
import { TaskView } from "@/components/tasks/task-view";
import type { Task } from "@/lib/domain/types";
import { selectByLifecycle } from "@/lib/store/selectors";
import * as React from "react";

export default function SomedayPage() {
  const select = React.useCallback((t: Task[]) => selectByLifecycle(t, "someday"), []);
  return (
    <StatusPageShell title="Someday">
      <TaskView
        title="Someday"
        description="A quiet shelf for ideas that aren't urgent. Revisit when the season is right."
        selector={select}
        emptyTitle="Empty shelf."
        enableBoard
      />
    </StatusPageShell>
  );
}
