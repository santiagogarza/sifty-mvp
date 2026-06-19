"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import { selectTodayTasks } from "@/lib/store/selectors";
import * as React from "react";

const greeting = (() => {
  const hour = new Date().getHours();
  if (hour < 5) return "Late one";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Late one";
})();

const dateLine = new Date().toLocaleDateString(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export default function TodayPage() {
  return (
    <PageShell title="Today" subtitle={dateLine}>
      <TaskView
        eyebrow={greeting}
        title="What matters today"
        description="Overdue, due today, and anything Sifty believes belongs in your top of mind."
        selector={selectTodayTasks}
        emptyTitle="Nothing pressing today."
        emptyDescription="When something needs your attention, it'll show up here. Until then, enjoy the quiet."
      />
    </PageShell>
  );
}
