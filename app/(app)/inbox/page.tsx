"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import { selectInboxTasks } from "@/lib/store/selectors";
import { useTranslations } from "next-intl";

export default function InboxPage() {
  const t = useTranslations("tasks.views.inbox");
  const status = useTranslations("common.status");
  return (
    <PageShell title={status("inbox.label")}>
      <TaskView
        title={status("inbox.label")}
        description={t("description")}
        selector={selectInboxTasks}
        emptyTitle={t("emptyTitle")}
        emptyDescription={t("emptyDescription")}
      />
    </PageShell>
  );
}
