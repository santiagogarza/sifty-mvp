import { PageShell } from "@/components/app-shell/page-shell";
import { TaskBoardView } from "@/components/tasks/task-board-view";

export default function BoardPage() {
  return (
    <PageShell title="Board" width="wide">
      <TaskBoardView />
    </PageShell>
  );
}
