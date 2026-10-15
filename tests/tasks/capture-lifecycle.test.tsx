// @vitest-environment jsdom
import { AppFrame, useFrame } from "@/components/app-shell/app-frame";
import { useStore } from "@/lib/store/store";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/store/sync", () => ({
  useServerSync: () => ({ hydrated: true, error: null }),
}));
vi.mock("@/lib/ai/run-triage", () => ({
  runTriage: vi.fn(),
  isTriageInFlight: () => false,
}));

function CaptureInto() {
  const { openCapture } = useFrame();
  return (
    <button type="button" onClick={() => openCapture({ lifecycle: "waiting" })}>
      add-waiting
    </button>
  );
}

async function capture(text: string) {
  const box = await screen.findByPlaceholderText("What do you need to do?");
  fireEvent.change(box, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
  });
}

const byText = (text: string) => useStore.getState().tasks.find((t) => t.sourceText === text);

describe("openCapture lifecycle", () => {
  beforeEach(() => {
    useStore.setState({ tasks: [], labels: [], hydrated: true });
    // Radix and the sheet ask for these; jsdom has neither.
    window.matchMedia ??= ((q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(cleanup);

  it("files a column capture into that status, then resets to Inbox", async () => {
    render(
      <AppFrame>
        <CaptureInto />
      </AppFrame>,
    );

    fireEvent.click(screen.getByRole("button", { name: "add-waiting" }));
    expect(await screen.findByText("to Waiting on")).toBeInTheDocument();
    await capture("column capture");
    expect(byText("column capture")?.lifecycle).toBe("waiting");

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "c" });
    });
    await capture("plain capture");
    expect(byText("plain capture")?.lifecycle).toBe("inbox");
  });
});
