// @vitest-environment jsdom
import { PriorityPill } from "@/components/tasks/priority-pill";
import { priorityPillLabel } from "@/lib/domain/priority";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

/**
 * D11 / SIF-14: priority is a labeled pill, not a 2×2 glyph. Every bucket
 * has a plain-language label and a matching color; unranked tasks render
 * nothing in the compact (list/board) form.
 */

afterEach(() => {
  cleanup();
});

describe("priorityPillLabel", () => {
  it("names the two axes plainly", () => {
    expect(priorityPillLabel("do_now")).toBe("Urgent + important");
    expect(priorityPillLabel("schedule")).toBe("Important");
    expect(priorityPillLabel("delegate")).toBe("Urgent");
    expect(priorityPillLabel("drop")).toBe("Low priority");
    expect(priorityPillLabel("unset")).toBe("Not ranked");
  });
});

describe("PriorityPill", () => {
  it("renders label, bucket, and an accessible name", () => {
    render(<PriorityPill bucket="do_now" urgency={0.72} importance={0.8} />);
    const pill = screen.getByTestId("priority-pill");
    expect(pill).toHaveTextContent("Urgent + important");
    expect(pill).toHaveAttribute("data-bucket", "do_now");
    expect(pill).toHaveAttribute("aria-label", "Priority: Urgent + important");
  });

  it("compact form hides nothing but the unranked bucket", () => {
    const { unmount } = render(<PriorityPill bucket="unset" compact />);
    expect(screen.queryByTestId("priority-pill")).toBeNull();
    unmount();
    render(<PriorityPill bucket="drop" compact />);
    expect(screen.getByTestId("priority-pill")).toHaveTextContent("Low priority");
  });

  it("the full form shows an unranked task as such", () => {
    render(<PriorityPill bucket="unset" />);
    expect(screen.getByTestId("priority-pill")).toHaveTextContent("Not ranked");
  });
});
