"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { TaskBoard, TaskBoardSkeleton } from "@/components/tasks/task-board";
import { ViewToggle } from "@/components/tasks/view-toggle";
import { useStore } from "@/lib/store/store";

export default function BoardPage() {
  const { openDetail } = useFrame();
  const hydrated = useStore((s) => s.hydrated);

  return (
    <PageShell title="Board" wide>
      {/* Fills the viewport below the sticky top bar (h-14) and, under md,
          above main's 80px bottom-nav reserve — so columns scroll on their
          own instead of stretching the page. */}
      <div className="flex h-[calc(100dvh-3.5rem-80px)] flex-col md:h-[calc(100dvh-3.5rem)]">
        <PageHeader
          title="Board"
          description="Every task, by status. Drag a card to another column to move it."
          actions={<ViewToggle current="board" />}
        />
        <div className="min-h-0 flex-1">
          {hydrated ? <TaskBoard onOpen={openDetail} /> : <TaskBoardSkeleton />}
        </div>
      </div>
    </PageShell>
  );
}
