"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import type { Task } from "@/lib/domain/types";
import { type ViewArgs, selectByLifecycle } from "@/lib/store/selectors";
import * as React from "react";

export default function SomedayPage() {
  const select = React.useCallback(
    (t: Task[], args: ViewArgs) => selectByLifecycle(t, "someday", args),
    [],
  );
  return (
    <PageShell title="Someday">
      <TaskView
        title="Someday"
        description="A quiet shelf for ideas that aren't urgent. Revisit when the season is right."
        selector={select}
        emptyTitle="Empty shelf."
      />
    </PageShell>
  );
}
