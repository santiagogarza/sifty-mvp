// @vitest-environment jsdom
import { AppFrame, useFrame } from "@/components/app-shell/app-frame";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A board column's Add captures into that column; plain capture stays Inbox. */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/store/sync", () => ({
  useServerSync: () => ({ hydrated: true, error: null, rejected: 0 }),
}));
vi.mock("@/lib/ai/run-triage", () => ({
  resiftTask: vi.fn(),
  watchSift: vi.fn(),
  isTriageInFlight: () => false,
}));

function AddToWaiting() {
  const { openCapture } = useFrame();
  return (
    <button type="button" onClick={() => openCapture({ lifecycle: "waiting" })}>
      Add to Waiting on
    </button>
  );
}

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [] });
  window.matchMedia ??= ((query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
});

async function captureText(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(await screen.findByPlaceholderText("What do you need to do?"), text);
  await user.keyboard("{Control>}{Enter}{/Control}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: /Capture/ })).toBeNull());
}

describe("openCapture({ lifecycle })", () => {
  it("creates the task in the requested column, and the next plain capture in the Inbox", async () => {
    const user = userEvent.setup();
    render(
      <AppFrame>
        <AddToWaiting />
      </AppFrame>,
    );

    await user.click(screen.getByRole("button", { name: "Add to Waiting on" }));
    expect(screen.getByTestId("capture-lifecycle")).toHaveTextContent("Waiting on");
    await captureText(user, "Legal to return the MSA");

    await user.keyboard("{Escape}");
    await user.keyboard("c");
    expect(screen.queryByTestId("capture-lifecycle")).toBeNull();
    await captureText(user, "Plain capture");

    const byTitle = new Map(useStore.getState().tasks.map((t) => [t.title, t.lifecycle]));
    expect(byTitle.get("Legal to return the MSA")).toBe("waiting");
    expect(byTitle.get("Plain capture")).toBe("inbox");
  });
});
