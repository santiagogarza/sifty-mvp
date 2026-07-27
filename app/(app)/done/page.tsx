"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageShell } from "@/components/app-shell/page-shell";
import { TaskList } from "@/components/tasks/task-list";
import { TaskView } from "@/components/tasks/task-view";
import { statusLabel } from "@/lib/domain/status";
import { selectDoneTasks, selectDroppedTasks } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { useBoardMode } from "@/lib/store/view-mode";
import { cn } from "@/lib/utils/cn";
import { ChevronRight } from "lucide-react";
import * as React from "react";

export default function DonePage() {
  const view = useBoardMode();
  const board = view.mode === "board";
  return (
    <PageShell title={statusLabel("done")} width={board ? "wide" : "prose"}>
      <TaskView
        title="Done"
        description="Finished work, newest first. Uncheck anything to send it back to Focus."
        selector={selectDoneTasks}
        emptyTitle="Nothing finished yet."
        emptyDescription="Completed tasks land here, so checking one off never loses it."
        view={view}
      />
      {/* Dropped has no column, so it has nothing to say under a board. */}
      {board ? null : <DroppedSection />}
    </PageShell>
  );
}

/**
 * Dropped tasks live behind a disclosure at the end of Done — kept for
 * reference, never given a nav item of their own. Renders nothing when
 * there is nothing dropped.
 */
function DroppedSection() {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const [expanded, setExpanded] = React.useState(false);

  const dropped = React.useMemo(() => selectDroppedTasks(tasks), [tasks]);
  if (!hydrated || dropped.length === 0) return null;

  return (
    <section className="mt-8 mb-10 pt-4 border-t border-[var(--border)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="dropped-tasks"
        className="flex w-full items-center justify-between text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
      >
        <span>
          Dropped{" "}
          <span className="text-num text-[11.5px] text-[var(--fg-subtle)]">{dropped.length}</span>
        </span>
        <ChevronRight
          size={13}
          className={cn(
            "transition-transform duration-200 ease-[var(--ease-product)]",
            expanded && "rotate-90",
          )}
        />
      </button>
      {expanded ? (
        <div id="dropped-tasks" className="mt-2">
          <TaskList tasks={dropped} onOpen={openDetail} autoFocus={false} />
        </div>
      ) : null}
    </section>
  );
}
