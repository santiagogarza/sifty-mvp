"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import { useRouteViewMode } from "@/components/tasks/use-view-mode";
import { selectInboxTasks } from "@/lib/store/selectors";

export default function InboxPage() {
  const [mode] = useRouteViewMode();
  return (
    <PageShell title="Inbox" wide={mode === "board"}>
      <TaskView
        title="Inbox"
        description="Newly captured tasks. Review, then move them into Focus, Waiting on, or Someday — or just leave them; Today will pull what matters."
        selector={selectInboxTasks}
        emptyTitle="Inbox zero."
        emptyDescription="Capture anything on your mind. Sifty will organize it before you next check."
      />
    </PageShell>
  );
}
