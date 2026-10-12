// @vitest-environment jsdom
import { CaptureDialog } from "@/components/tasks/capture-dialog";
import { useStore } from "@/lib/store/store";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SIF-21: a capture draft survives Escape (and any dismiss that isn't a
 * capture). Only a successful capture or an explicit Discard clears it.
 */

const openDetail = vi.fn();
vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({ openDetail, openCapture: vi.fn(), openCommand: vi.fn() }),
}));
vi.mock("@/lib/ai/run-triage", () => ({ runTriage: vi.fn() }));

const PLACEHOLDER = "What do you need to do?";

/** Owns `open` like AppFrame does, and exposes a handle to drive it. */
function Harness({ handle }: { handle: { setOpen: (v: boolean) => void } }) {
  const [open, setOpen] = React.useState(true);
  handle.setOpen = setOpen;
  return <CaptureDialog open={open} onOpenChange={setOpen} />;
}

function renderCapture() {
  const handle = { setOpen: (_v: boolean) => {} };
  render(<Harness handle={handle} />);
  const reopen = () => act(() => handle.setOpen(true));
  return { reopen };
}

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [] });
  openDetail.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("CaptureDialog draft", () => {
  it("restores the text after Escape", async () => {
    const user = userEvent.setup();
    const { reopen } = renderCapture();

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), "Call the dentist");
    await user.keyboard("{Escape}");
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();

    reopen();
    const textarea = screen.getByPlaceholderText(PLACEHOLDER);
    expect(textarea).toHaveValue("Call the dentist");
    expect(useStore.getState().tasks).toHaveLength(0);
  });

  it("restores the context field and its open state", async () => {
    const user = userEvent.setup();
    const { reopen } = renderCapture();

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), "Book flights");
    await user.click(screen.getByRole("button", { name: "Add context" }));
    await user.type(screen.getByPlaceholderText(/Anything Sifty should know/), "Trip in March");
    await user.keyboard("{Escape}");

    reopen();
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue("Book flights");
    expect(screen.getByPlaceholderText(/Anything Sifty should know/)).toHaveValue("Trip in March");
    expect(screen.getByRole("button", { name: "Hide context" })).toBeInTheDocument();
  });

  it("clears the draft after a successful capture and creates exactly one task", async () => {
    const user = userEvent.setup();
    const { reopen } = renderCapture();

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), "Renew passport");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(useStore.getState().tasks).toHaveLength(1);
    expect(useStore.getState().tasks[0]?.sourceText).toBe("Renew passport");

    reopen();
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
  });

  it("Discard clears the draft and closes; the next open is empty", async () => {
    const user = userEvent.setup();
    const { reopen } = renderCapture();

    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    await user.type(screen.getByPlaceholderText(PLACEHOLDER), "Half a thought");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();

    reopen();
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue("");
    expect(useStore.getState().tasks).toHaveLength(0);
  });

  it("an empty dialog still closes on Escape", async () => {
    const user = userEvent.setup();
    renderCapture();

    await user.keyboard("{Escape}");
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();
  });
});
