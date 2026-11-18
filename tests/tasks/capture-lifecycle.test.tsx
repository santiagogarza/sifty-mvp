// @vitest-environment jsdom

import { AppFrame, useFrame } from "@/components/app-shell/app-frame";
import { useStore } from "@/lib/store/store";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));

function Harness() {
  const { openCapture } = useFrame();
  return (
    <>
      <button type="button" onClick={() => openCapture({ lifecycle: "waiting" })}>
        Open waiting
      </button>
      <button type="button" onClick={() => openCapture()}>
        Open plain
      </button>
    </>
  );
}

async function capture(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByPlaceholderText("What do you need to do?"), text);
  await user.click(screen.getByRole("button", { name: "Capture" }));
}

describe("openCapture lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ tasks: [], labels: [], hydrated: true });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
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

  it("files a column capture into that status, then the next plain capture into Inbox", async () => {
    const user = userEvent.setup();
    render(
      <AppFrame>
        <Harness />
      </AppFrame>,
    );

    await user.click(screen.getByRole("button", { name: "Open waiting" }));
    await capture(user, "Waiting on Sam");
    expect(
      useStore.getState().tasks.find((task) => task.sourceText === "Waiting on Sam")?.lifecycle,
    ).toBe("waiting");

    await user.click(screen.getByRole("button", { name: "Open plain" }));
    await capture(user, "Fresh inbox");
    expect(
      useStore.getState().tasks.find((task) => task.sourceText === "Fresh inbox")?.lifecycle,
    ).toBe("inbox");
  });
});
