"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import { selectFocusTasks } from "@/lib/store/selectors";
import { useTranslations } from "next-intl";

export default function FocusPage() {
  const t = useTranslations("tasks.views.focus");
  const status = useTranslations("common.status");
  return (
    <PageShell title={status("active.label")}>
      <TaskView
        title={status("active.label")}
        description={t("description")}
        selector={selectFocusTasks}
        emptyTitle={t("emptyTitle")}
        emptyDescription={t("emptyDescription")}
      />
    </PageShell>
  );
}
