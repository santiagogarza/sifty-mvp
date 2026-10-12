// @vitest-environment jsdom
import { GlobalKeyboard } from "@/components/app-shell/keyboard";
import { CaptureDialog } from "@/components/tasks/capture-dialog";
import { useStore } from "@/lib/store/store";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Capture draft contract: dismissing keeps the draft for the next open;
 * only a successful capture or an explicit Discard clears it.
 */

const openDetail = vi.fn();
const runTriage = vi.fn();

vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({ openDetail, openCapture: vi.fn(), openCommand: vi.fn() }),
}));
vi.mock("@/lib/ai/run-triage", () => ({
  runTriage: (id: string) => runTriage(id),
}));

function Harness() {
  const [open, setOpen] = React.useState(false);
  const openCapture = React.useCallback(() => setOpen(true), []);
  return (
    <>
      <CaptureDialog open={open} onOpenChange={setOpen} />
      <GlobalKeyboard onCapture={openCapture} onCommand={() => {}} />
    </>
  );
}

const titleBox = () =>
  screen.getByPlaceholderText("What do you need to do?") as HTMLTextAreaElement;
const contextBox = () => screen.queryByPlaceholderText(/Anything Sifty should know/);

async function openCapture(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("c");
  const box = await screen.findByPlaceholderText("What do you need to do?");
  await waitFor(() => expect(box).toHaveFocus());
  return box as HTMLTextAreaElement;
}

async function waitForClosed() {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

beforeEach(() => {
  useStore.setState({ tasks: [] });
  openDetail.mockClear();
  runTriage.mockClear();
});

describe("CaptureDialog draft", () => {
  it("restores the title after Escape, with the caret at the end", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openCapture(user);
    await user.keyboard("Call the dentist");
    await user.keyboard("{Escape}");
    await waitForClosed();

    const box = await openCapture(user);
    expect(box).toHaveValue("Call the dentist");
    await waitFor(() => expect(box.selectionStart).toBe("Call the dentist".length));
    expect(useStore.getState().tasks).toHaveLength(0);
  });

  it("restores context text and the open context field", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openCapture(user);
    await user.keyboard("Book flights");
    await user.click(screen.getByRole("button", { name: /Add context/ }));
    await user.type(contextBox() as HTMLElement, "Before the offsite");
    await user.keyboard("{Escape}");
    await waitForClosed();

    await openCapture(user);
    expect(titleBox()).toHaveValue("Book flights");
    expect(contextBox()).toHaveValue("Before the offsite");
    expect(screen.getByRole("button", { name: /Hide context/ })).toBeInTheDocument();
  });

  it("Cmd+Enter creates one task, opens detail, and clears the draft", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openCapture(user);
    await user.keyboard("Renew passport");
    await user.click(screen.getByRole("button", { name: /Add context/ }));
    await user.type(contextBox() as HTMLElement, "Expires in May");
    await user.click(titleBox());
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitForClosed();

    const tasks = useStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.sourceText).toBe("Renew passport");
    expect(tasks[0]?.sourceContext).toBe("Expires in May");
    await waitFor(() => expect(openDetail).toHaveBeenCalledWith(tasks[0]?.id));
    await waitFor(() => expect(runTriage).toHaveBeenCalledWith(tasks[0]?.id));
    expect(openDetail).toHaveBeenCalledTimes(1);
    expect(runTriage).toHaveBeenCalledTimes(1);

    await openCapture(user);
    expect(titleBox()).toHaveValue("");
    expect(contextBox()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add context/ })).toBeInTheDocument();
  });

  it("Capture button submits once and clears the draft", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openCapture(user);
    await user.keyboard("Water plants");
    await user.click(screen.getByRole("button", { name: "Capture" }));
    await waitForClosed();

    expect(useStore.getState().tasks).toHaveLength(1);
    await openCapture(user);
    expect(titleBox()).toHaveValue("");
  });

  it("Discard is hidden when empty, and clears and closes when used", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openCapture(user);
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();

    await user.keyboard("Maybe later");
    await user.click(screen.getByRole("button", { name: /Add context/ }));
    await user.type(contextBox() as HTMLElement, "Some notes");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await waitForClosed();

    await openCapture(user);
    expect(titleBox()).toHaveValue("");
    expect(contextBox()).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
    expect(useStore.getState().tasks).toHaveLength(0);
  });

  it("shows Discard for context-only drafts", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openCapture(user);
    await user.click(screen.getByRole("button", { name: /Add context/ }));
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
    await user.type(contextBox() as HTMLElement, "Just context");
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("an empty dialog closes on Escape without a confirm", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openCapture(user);
    await user.keyboard("{Escape}");
    await waitForClosed();
    expect(useStore.getState().tasks).toHaveLength(0);
  });
});
