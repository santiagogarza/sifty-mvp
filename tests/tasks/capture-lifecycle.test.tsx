// @vitest-environment jsdom

import { AppFrame, useFrame } from "@/components/app-shell/app-frame";
import type { Lifecycle } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
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

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], memories: [], hydrated: true });
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401 });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});

async function capture(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByPlaceholderText("What do you need to do?"), text);
  await user.click(screen.getByRole("button", { name: "Capture" }));
}

function lifecycleOf(sourceText: string): Lifecycle | undefined {
  return useStore.getState().tasks.find((t) => t.sourceText === sourceText)?.lifecycle;
}

describe("openCapture lifecycle", () => {
  it("files a column capture into that status and the next plain capture into inbox", async () => {
    const user = userEvent.setup();
    render(
      <AppFrame>
        <Harness />
      </AppFrame>,
    );

    await user.click(screen.getByRole("button", { name: "Open waiting" }));
    await capture(user, "Chase the vendor");
    expect(lifecycleOf("Chase the vendor")).toBe("waiting");

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Open plain" }));
    await capture(user, "Buy milk");
    expect(lifecycleOf("Buy milk")).toBe("inbox");
  });
});
