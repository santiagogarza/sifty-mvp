// @vitest-environment jsdom
import { PriorityPill } from "@/components/tasks/priority-pill";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithIntl } from "../helpers/intl";

/**
 * D11 / SIF-14: priority is a labeled pill, not a 2×2 glyph. Every bucket
 * has a plain-language label and a matching color; unranked tasks render
 * nothing in the compact (list/board) form.
 */

afterEach(() => {
  cleanup();
});

describe("PriorityPill labels", () => {
  it("names the two axes plainly", () => {
    const labels = {
      do_now: "Urgent + important",
      schedule: "Important",
      delegate: "Urgent",
      drop: "Low priority",
      unset: "Not ranked",
    } as const;
    for (const [bucket, label] of Object.entries(labels)) {
      const { unmount } = renderWithIntl(<PriorityPill bucket={bucket as keyof typeof labels} />);
      expect(screen.getByTestId("priority-pill")).toHaveTextContent(label);
      unmount();
    }
  });
});

describe("PriorityPill", () => {
  it("renders label, bucket, and an accessible name", () => {
    renderWithIntl(<PriorityPill bucket="do_now" urgency={0.72} importance={0.8} />);
    const pill = screen.getByTestId("priority-pill");
    expect(pill).toHaveTextContent("Urgent + important");
    expect(pill).toHaveAttribute("data-bucket", "do_now");
    expect(pill).toHaveAttribute("aria-label", "Priority: Urgent + important");
  });

  it("compact form hides nothing but the unranked bucket", () => {
    const { unmount } = renderWithIntl(<PriorityPill bucket="unset" compact />);
    expect(screen.queryByTestId("priority-pill")).toBeNull();
    unmount();
    renderWithIntl(<PriorityPill bucket="drop" compact />);
    expect(screen.getByTestId("priority-pill")).toHaveTextContent("Low priority");
  });

  it("the full form shows an unranked task as such", () => {
    renderWithIntl(<PriorityPill bucket="unset" />);
    expect(screen.getByTestId("priority-pill")).toHaveTextContent("Not ranked");
  });

  it("renders in Spanish from the es catalog", () => {
    renderWithIntl(<PriorityPill bucket="do_now" urgency={0.72} importance={0.8} />, {
      locale: "es",
    });
    const pill = screen.getByTestId("priority-pill");
    expect(pill).toHaveTextContent("Urgente + importante");
    expect(pill).toHaveAttribute("aria-label", "Prioridad: Urgente + importante");
  });
});
