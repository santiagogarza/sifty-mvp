"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import type { Task } from "@/lib/domain/types";
import { selectByLifecycle } from "@/lib/store/selectors";
import { useBoardMode } from "@/lib/store/view-mode";
import * as React from "react";

export default function SomedayPage() {
  const view = useBoardMode();
  const select = React.useCallback((t: Task[]) => selectByLifecycle(t, "someday"), []);
  return (
    <PageShell title="Someday" width={view.mode === "board" ? "wide" : "prose"}>
      <TaskView
        title="Someday"
        description="A quiet shelf for ideas that aren't urgent. Revisit when the season is right."
        selector={select}
        emptyTitle="Empty shelf."
        view={view}
      />
    </PageShell>
  );
}
