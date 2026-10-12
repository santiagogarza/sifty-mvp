// @vitest-environment jsdom
import { DecisionsSync } from "@/components/decisions/decisions-sync";
import { useDecisionsStore } from "@/lib/decisions/client";
import { SIFT_SETTLED_EVENT, announceSiftSettled } from "@/lib/decisions/events";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The badge stays honest without a socket: the cache refreshes when the
 * server pull has settled, when the tab comes back, and when a watched
 * sift settles (the moment a question can appear).
 */

let serverReady = true;
vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({
    openDetail: vi.fn(),
    openCapture: vi.fn(),
    openCommand: vi.fn(),
    serverReady,
  }),
}));
vi.mock("@/lib/ai/run-triage", () => ({ watchSift: vi.fn() }));

const refresh = vi.fn();

beforeEach(() => {
  serverReady = true;
  refresh.mockReset().mockResolvedValue(undefined);
  useDecisionsStore.setState({ refresh });
});

afterEach(() => cleanup());

describe("DecisionsSync", () => {
  it("refreshes once the server pull has settled, then on focus, visibility, and sift-settled", () => {
    render(<DecisionsSync />);
    expect(refresh).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(3);

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(3);

    announceSiftSettled("task_1");
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it("waits for the server pull and detaches its listeners on unmount", () => {
    serverReady = false;
    const { unmount } = render(<DecisionsSync />);
    expect(refresh).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent(SIFT_SETTLED_EVENT));
    expect(refresh).not.toHaveBeenCalled();
    unmount();

    serverReady = true;
    const mounted = render(<DecisionsSync />);
    expect(refresh).toHaveBeenCalledTimes(1);
    mounted.unmount();
    window.dispatchEvent(new Event("focus"));
    announceSiftSettled("task_2");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
