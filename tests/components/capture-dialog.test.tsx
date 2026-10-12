// @vitest-environment jsdom
import { CaptureDialog } from "@/components/tasks/capture-dialog";
import { useStore } from "@/lib/store/store";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("@/lib/ai/run-triage", () => ({ watchSift: vi.fn() }));

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
    const textarea = screen.getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement;
    expect(textarea).toHaveValue("Call the dentist");
    expect(useStore.getState().tasks).toHaveLength(0);

    // Picks up where the user left off: focused, caret at the end.
    await waitFor(() => {
      expect(textarea).toHaveFocus();
      expect(textarea.selectionStart).toBe("Call the dentist".length);
      expect(textarea.selectionEnd).toBe("Call the dentist".length);
    });
  });

  it("restores the draft after a click outside the dialog", async () => {
    const user = userEvent.setup();
    const { reopen } = renderCapture();

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), "Water the plants");
    // Radix dismisses on pointer-down outside the content; the overlay is
    // the only thing outside it that is interactive here.
    const dialog = screen.getByRole("dialog");
    const overlay = dialog.previousElementSibling as HTMLElement;
    await user.click(overlay);
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();

    reopen();
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue("Water the plants");
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
    // The server sifts on create; the dialog only starts the watcher.
    const { watchSift } = await import("@/lib/ai/run-triage");
    await waitFor(() => expect(watchSift).toHaveBeenCalledWith(useStore.getState().tasks[0]!.id));

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

describe("CaptureDialog natural-language due date", () => {
  function tomorrowIso(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  it("shows a due chip while typing and stores the date as a protected due", async () => {
    const user = userEvent.setup();
    renderCapture();

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), "Call the dentist tomorrow 3pm");
    const chip = screen.getByTestId("capture-due-chip");
    expect(chip).toHaveTextContent(/^Due .*· 3pm$/);
    expect(screen.getByText("from “tomorrow 3pm”")).toBeInTheDocument();

    await user.keyboard("{Control>}{Enter}{/Control}");
    const task = useStore.getState().tasks[0]!;
    expect(task.due).toBe(tomorrowIso());
    expect(task.editedFields).toEqual(["due"]);
    // The phrase leaves the title; the raw capture is kept verbatim.
    expect(task.title).toBe("Call the dentist");
    expect(task.sourceText).toBe("Call the dentist tomorrow 3pm");
  });

  it("removing the chip captures the text as typed, with no due", async () => {
    const user = userEvent.setup();
    renderCapture();

    const textarea = screen.getByPlaceholderText(PLACEHOLDER);
    await user.type(textarea, "Send the report by Friday");
    expect(screen.getByTestId("capture-due-chip")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove due date" }));
    expect(screen.queryByTestId("capture-due-chip")).toBeNull();
    expect(textarea).toHaveFocus();

    // Typing on keeps it dismissed while the same phrase is what parses…
    await user.type(textarea, " please");
    expect(screen.queryByTestId("capture-due-chip")).toBeNull();

    await user.keyboard("{Control>}{Enter}{/Control}");
    const task = useStore.getState().tasks[0]!;
    expect(task.due).toBeNull();
    expect(task.editedFields).toEqual([]);
    expect(task.title).toBe("Send the report by Friday please");
  });

  it("a removed chip stays removed when the same phrase grows a time of day", async () => {
    const user = userEvent.setup();
    renderCapture();

    const textarea = screen.getByPlaceholderText(PLACEHOLDER);
    await user.type(textarea, "Call Ana tomorrow");
    await user.click(screen.getByRole("button", { name: "Remove due date" }));
    await user.type(textarea, " 3pm");
    expect(textarea).toHaveValue("Call Ana tomorrow 3pm");
    expect(screen.queryByTestId("capture-due-chip")).toBeNull();

    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(useStore.getState().tasks[0]!.due).toBeNull();
  });

  it("a removed chip stays removed with the draft across Escape and reopen", async () => {
    const user = userEvent.setup();
    const { reopen } = renderCapture();

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), "Send the report by Friday");
    await user.click(screen.getByRole("button", { name: "Remove due date" }));
    await user.keyboard("{Escape}");

    reopen();
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue("Send the report by Friday");
    expect(screen.queryByTestId("capture-due-chip")).toBeNull();
  });

  it("editing the phrase in place after removing the chip re-offers the new date", async () => {
    const user = userEvent.setup();
    renderCapture();

    const textarea = screen.getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement;
    await user.type(textarea, "Send the report by Friday");
    await user.click(screen.getByRole("button", { name: "Remove due date" }));
    expect(screen.queryByTestId("capture-due-chip")).toBeNull();

    // Replace just the day: "Friday" → "Monday". The removed phrase is gone
    // from the text, so the new phrase is a new offer.
    textarea.setSelectionRange("Send the report by ".length, textarea.value.length);
    await user.keyboard("Monday");
    expect(textarea).toHaveValue("Send the report by Monday");
    expect(screen.getByTestId("capture-due-chip")).toBeInTheDocument();
    expect(screen.getByText("from “by Monday”")).toBeInTheDocument();
  });

  it("a removed chip comes back once the phrase leaves the text and a date is typed again", async () => {
    const user = userEvent.setup();
    renderCapture();

    const textarea = screen.getByPlaceholderText(PLACEHOLDER);
    await user.type(textarea, "Call Ana tomorrow");
    await user.click(screen.getByRole("button", { name: "Remove due date" }));
    expect(screen.queryByTestId("capture-due-chip")).toBeNull();

    // Retyping the same text from scratch is a new decision.
    await user.clear(textarea);
    await user.type(textarea, "Call Ana tomorrow");
    expect(screen.getByTestId("capture-due-chip")).toBeInTheDocument();

    // Removing again and changing the phrase to a different date also re-offers.
    await user.click(screen.getByRole("button", { name: "Remove due date" }));
    await user.clear(textarea);
    await user.type(textarea, "Call Ana next week");
    expect(screen.getByTestId("capture-due-chip")).toBeInTheDocument();
  });

  it("shows no chip for text without a date", async () => {
    const user = userEvent.setup();
    renderCapture();
    await user.type(screen.getByPlaceholderText(PLACEHOLDER), "Buy flowers for mom");
    expect(screen.queryByTestId("capture-due-chip")).toBeNull();
  });
});
