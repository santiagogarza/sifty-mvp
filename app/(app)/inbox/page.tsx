"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { TaskView } from "@/components/tasks/task-view";
import { selectInboxTasks } from "@/lib/store/selectors";
import { useBoardMode } from "@/lib/store/view-mode";

export default function InboxPage() {
  const [mode] = useBoardMode();
  return (
    <PageShell title="Inbox" width={mode === "board" ? "wide" : "default"}>
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
