"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TODAY_BOARD_COLUMNS } from "@/components/tasks/task-board";
import { TaskView } from "@/components/tasks/task-view";
import type { BoardPartitionArgs } from "@/lib/store/board";
import { selectTodayTasks } from "@/lib/store/selectors";
import * as React from "react";

const TODAY_BOARD_ARGS: BoardPartitionArgs = { todayOnly: true };

function getTimeGreeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return "Late one";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Late one";
}

function getDateLine(now: Date): string {
  return now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default function TodayPage() {
  const [greeting, setGreeting] = React.useState<string | null>(null);
  const [dateLine, setDateLine] = React.useState<string | null>(null);

  React.useEffect(() => {
    const now = new Date();
    setGreeting(getTimeGreeting(now));
    setDateLine(getDateLine(now));
  }, []);

  return (
    <PageShell title="Today" subtitle={dateLine ?? undefined}>
      <TaskView
        eyebrow={greeting ?? undefined}
        title="What matters today"
        description="Overdue, due today, and anything Sifty believes belongs in your top of mind."
        selector={selectTodayTasks}
        boardColumns={TODAY_BOARD_COLUMNS}
        boardArgs={TODAY_BOARD_ARGS}
        emptyTitle="Nothing pressing today."
        emptyDescription="When something needs your attention, it'll show up here. Until then, enjoy the quiet."
      />
    </PageShell>
  );
}
