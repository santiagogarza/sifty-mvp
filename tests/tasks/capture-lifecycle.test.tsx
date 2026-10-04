// @vitest-environment jsdom
import { AppFrame, useFrame } from "@/components/app-shell/app-frame";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A board column's Add captures straight into that column; everything else
 * still captures into Inbox — including the very next plain capture after
 * a column Add, because closing the dialog resets the requested status.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/store/sync", () => ({
  useServerSync: () => ({ hydrated: true, authenticated: true, error: null }),
}));
vi.mock("@/lib/ai/run-triage", () => ({
  runTriage: vi.fn(),
  isTriageInFlight: () => false,
}));

afterEach(cleanup);

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], memories: [], hydrated: true });
  // ThemeProvider reads the OS color scheme; jsdom has no matchMedia.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
});

function Triggers() {
  const { openCapture } = useFrame();
  return (
    <>
      <button type="button" onClick={() => openCapture({ lifecycle: "waiting" })}>
        add to waiting
      </button>
      <button type="button" onClick={() => openCapture()}>
        plain capture
      </button>
    </>
  );
}

async function capture(text: string) {
  const box = await screen.findByPlaceholderText("What do you need to do?");
  await userEvent.type(box, text);
  await userEvent.click(screen.getByRole("button", { name: "Capture" }));
  await waitFor(() => expect(screen.queryByPlaceholderText("What do you need to do?")).toBeNull());
  return useStore.getState().tasks.find((t) => t.sourceText === text)!;
}

describe("openCapture({ lifecycle })", () => {
  it("files the capture into the requested status, then the next plain capture is inbox", async () => {
    render(
      <AppFrame>
        <Triggers />
      </AppFrame>,
    );

    await userEvent.click(screen.getByRole("button", { name: "add to waiting" }));
    expect(
      await screen.findByText("Files into Waiting on. Sifty organizes the rest."),
    ).toBeVisible();
    const waiting = await capture("Chase the contractor");
    expect(waiting.lifecycle).toBe("waiting");

    await userEvent.click(screen.getByRole("button", { name: "plain capture" }));
    expect(
      await screen.findByText("Type the task as you'd say it. Sifty organizes it."),
    ).toBeVisible();
    const inbox = await capture("Buy stamps");
    expect(inbox.lifecycle).toBe("inbox");
  });
});
