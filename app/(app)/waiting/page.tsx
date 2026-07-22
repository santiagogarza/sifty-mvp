"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import { statusLabel } from "@/lib/domain/status";
import type { Task } from "@/lib/domain/types";
import { selectByLifecycle } from "@/lib/store/selectors";
import * as React from "react";

export default function WaitingPage() {
  const select = React.useCallback((t: Task[]) => selectByLifecycle(t, "waiting"), []);
  return (
    <PageShell title={statusLabel("waiting")}>
      <TaskView
        title={statusLabel("waiting")}
        description="Things you've handed off — to a person, an agent, or a process. Move them back to Focus when the ball returns; Today will nudge you when a deadline arrives."
        selector={select}
        emptyTitle="Nothing in flight."
      />
    </PageShell>
  );
}
