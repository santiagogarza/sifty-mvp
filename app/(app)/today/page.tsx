"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { DailyPlanCard } from "@/components/tasks/daily-plan-card";
import { TaskView } from "@/components/tasks/task-view";
import { selectTodayTasks } from "@/lib/store/selectors";
import * as React from "react";

function getDateLine(now: Date): string {
  return now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default function TodayPage() {
  const [dateLine, setDateLine] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDateLine(getDateLine(new Date()));
  }, []);

  return (
    <PageShell title="Today" subtitle={dateLine ?? undefined}>
      <TaskView
        title="What matters today"
        description="Overdue, due today, and anything Sifty believes belongs in your top of mind."
        selector={selectTodayTasks}
        emptyTitle="Nothing pressing today."
        emptyDescription="When something needs your attention, it'll show up here. Until then, enjoy the quiet."
        aboveList={<DailyPlanCard />}
      />
    </PageShell>
  );
}
