// @vitest-environment jsdom

import { AppFrame } from "@/components/app-shell/app-frame";
import { useFrame } from "@/components/app-shell/app-frame";
import type { Lifecycle } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/ai/run-triage", () => ({
  runTriage: vi.fn(),
  isTriageInFlight: () => false,
}));

function OpenCapture({ lifecycle, label }: { lifecycle?: Lifecycle; label: string }) {
  const { openCapture } = useFrame();
  return (
    <button type="button" onClick={() => openCapture(lifecycle ? { lifecycle } : undefined)}>
      {label}
    </button>
  );
}

describe("openCapture lifecycle", () => {
  beforeEach(() => {
    useStore.setState({ tasks: [], labels: [], hydrated: true });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("files a column capture, then the next plain capture starts in Inbox", async () => {
    const user = userEvent.setup();
    render(
      <AppFrame>
        <OpenCapture lifecycle="waiting" label="Open waiting" />
        <OpenCapture label="Open plain" />
      </AppFrame>,
    );

    await user.click(screen.getByRole("button", { name: "Open waiting" }));
    await user.type(screen.getByPlaceholderText("What do you need to do?"), "Chase the vendor");
    await user.click(screen.getByRole("button", { name: "Capture" }));

    await user.click(screen.getByRole("button", { name: "Open plain" }));
    await user.type(screen.getByPlaceholderText("What do you need to do?"), "A fresh thought");
    await user.click(screen.getByRole("button", { name: "Capture" }));

    const tasks = useStore.getState().tasks;
    const waiting = tasks.find((task) => task.sourceText === "Chase the vendor");
    const inbox = tasks.find((task) => task.sourceText === "A fresh thought");
    expect(waiting?.lifecycle).toBe("waiting");
    expect(inbox?.lifecycle).toBe("inbox");
  });
});
