// @vitest-environment jsdom
import {
  ConfidencePill,
  confidenceBand,
  confidencePercent,
} from "@/components/tasks/confidence-pill";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

/**
 * SIF-11: confidence and rationale surface on a pill; low confidence is
 * flagged amber; tasks without a confidence render nothing and never crash.
 */

afterEach(() => {
  cleanup();
});

describe("confidenceBand", () => {
  it("bands sifted tasks and ignores the rest", () => {
    expect(confidenceBand({ aiStatus: "ready", confidence: 0.87 })).toBe("ok");
    expect(confidenceBand({ aiStatus: "ready", confidence: 0.6 })).toBe("ok");
    expect(confidenceBand({ aiStatus: "ready", confidence: 0.59 })).toBe("low");
    expect(confidenceBand({ aiStatus: "ready", confidence: 0 })).toBeNull();
    expect(confidenceBand({ aiStatus: "running", confidence: 0.9 })).toBeNull();
    expect(confidenceBand({ aiStatus: "failed", confidence: 0.9 })).toBeNull();
    expect(confidenceBand({ aiStatus: "ready", confidence: Number.NaN })).toBeNull();
  });
});

describe("ConfidencePill", () => {
  it("renders the percent and opens the rationale on keyboard focus", async () => {
    const user = userEvent.setup();
    render(
      <ConfidencePill
        task={{ aiStatus: "ready", confidence: 0.874, rationale: "Deadline is explicit." }}
      />,
    );

    const pill = screen.getByTestId("confidence-pill");
    expect(pill).toHaveTextContent("Sifted · 87%");
    expect(pill).toHaveAttribute("data-band", "ok");

    await user.tab();
    expect(pill).toHaveFocus();
    expect((await screen.findAllByText("Confidence: 87%")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Deadline is explicit.")).length).toBeGreaterThan(0);
  });

  it("flags low confidence", () => {
    render(<ConfidencePill task={{ aiStatus: "ready", confidence: 0.38, rationale: null }} />);
    const pill = screen.getByTestId("confidence-pill");
    expect(pill).toHaveAttribute("data-band", "low");
    expect(pill).toHaveAccessibleName("Sifty confidence 38%, low");
  });

  it("in compact form renders only for low confidence", () => {
    const { rerender } = render(
      <ConfidencePill compact task={{ aiStatus: "ready", confidence: 0.9, rationale: null }} />,
    );
    expect(screen.queryByTestId("confidence-pill")).toBeNull();

    rerender(
      <ConfidencePill compact task={{ aiStatus: "ready", confidence: 0.4, rationale: null }} />,
    );
    expect(screen.getByTestId("confidence-pill")).toHaveTextContent("Unsure");
  });

  it("renders nothing for tasks without a confidence", () => {
    render(<ConfidencePill task={{ aiStatus: "ready", confidence: 0, rationale: null }} />);
    expect(screen.queryByTestId("confidence-pill")).toBeNull();
  });

  it("tooltip without a rationale shows only the confidence line", async () => {
    const user = userEvent.setup();
    render(<ConfidencePill task={{ aiStatus: "ready", confidence: 0.7, rationale: null }} />);
    await user.tab();
    expect((await screen.findAllByText("Confidence: 70%")).length).toBeGreaterThan(0);
    // The rationale paragraph is the only <p> the tooltip ever renders.
    expect(document.querySelector("[data-radix-popper-content-wrapper] p")).toBeNull();
  });

  it("clamps out-of-range confidences", () => {
    expect(confidencePercent(1.4)).toBe(100);
    expect(confidencePercent(-0.2)).toBe(0);
    expect(confidencePercent(0.874)).toBe(87);
  });
});
