"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { DailyPlanCard } from "@/components/tasks/daily-plan-card";
import { TaskView } from "@/components/tasks/task-view";
import { selectTodayTasks } from "@/lib/store/selectors";
import { useFormatter, useTranslations } from "next-intl";
import * as React from "react";

type Greeting = "late" | "morning" | "afternoon" | "evening";

function getTimeGreeting(now: Date): Greeting {
  const hour = now.getHours();
  if (hour < 5) return "late";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "late";
}

export default function TodayPage() {
  const t = useTranslations("tasks");
  const format = useFormatter();
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    setNow(new Date());
  }, []);

  const dateLine = now
    ? format.dateTime(now, {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
    : undefined;

  return (
    <PageShell title={t("views.today.pageTitle")} subtitle={dateLine}>
      <TaskView
        eyebrow={now ? t(`greeting.${getTimeGreeting(now)}`) : undefined}
        title={t("views.today.title")}
        description={t("views.today.description")}
        selector={selectTodayTasks}
        emptyTitle={t("views.today.emptyTitle")}
        emptyDescription={t("views.today.emptyDescription")}
        aboveList={<DailyPlanCard />}
      />
    </PageShell>
  );
}
