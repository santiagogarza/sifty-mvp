"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import type { Task } from "@/lib/domain/types";
import { selectByLifecycle } from "@/lib/store/selectors";
import { useTranslations } from "next-intl";
import * as React from "react";

export default function SomedayPage() {
  const t = useTranslations("tasks.views.someday");
  const status = useTranslations("common.status");
  const select = React.useCallback((tasks: Task[]) => selectByLifecycle(tasks, "someday"), []);
  return (
    <PageShell title={status("someday.label")}>
      <TaskView
        title={status("someday.label")}
        description={t("description")}
        selector={select}
        emptyTitle={t("emptyTitle")}
      />
    </PageShell>
  );
}
