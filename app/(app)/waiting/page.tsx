"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import type { Task } from "@/lib/domain/types";
import { selectByLifecycle } from "@/lib/store/selectors";
import { useTranslations } from "next-intl";
import * as React from "react";

export default function WaitingPage() {
  const t = useTranslations("tasks.views.waiting");
  const status = useTranslations("common.status");
  const select = React.useCallback((tasks: Task[]) => selectByLifecycle(tasks, "waiting"), []);
  return (
    <PageShell title={status("waiting.label")}>
      <TaskView
        title={status("waiting.label")}
        description={t("description")}
        selector={select}
        emptyTitle={t("emptyTitle")}
      />
    </PageShell>
  );
}
