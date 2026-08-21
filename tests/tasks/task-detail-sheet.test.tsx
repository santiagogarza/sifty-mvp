// @vitest-environment jsdom
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { useStore } from "@/lib/store/store";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  cleanup();
  useStore.setState({ tasks: [] });
});

function seedTask() {
  return useStore.getState().createTask({
    sourceText: "A task with enough detail that the sheet overflows a short mobile viewport",
  });
}

describe("TaskDetailSheet — mobile bottom sheet scrolling", () => {
  it("makes the detail body a shrinkable flex column so its content region can scroll", () => {
    const task = seedTask();
    render(<TaskDetailSheet taskId={task.id} onClose={() => {}} />);

    // The region between the sticky header and the footer is the scroll area.
    const scrollRegion = document.querySelector(".overflow-y-auto");
    expect(scrollRegion).not.toBeNull();

    // On mobile the sheet is `bottom-0 max-h-[88dvh]` with no fixed height, so
    // the body must fill it via flexbox (flex-1) and be allowed to shrink below
    // its content (min-h-0) for the inner overflow-y-auto region to scroll.
    // Relying on height:100% (`h-full`) does not resolve under a max-height-only
    // parent on mobile, which leaves the body taller than the sheet and pushes
    // the footer off-screen with no way to scroll to it. jsdom can't compute
    // layout, so we assert this structural contract directly.
    const body = (scrollRegion as HTMLElement).parentElement as HTMLElement;
    expect(body.className).toContain("flex-col");
    expect(body.className).toContain("flex-1");
    expect(body.className).toContain("min-h-0");
    expect(body.className).not.toContain("h-full");
  });
});
