// @vitest-environment jsdom
import DonePage from "@/app/(app)/done/page";
import { useStore } from "@/lib/store/store";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTask } from "../helpers/tasks";

vi.mock("next/navigation", () => ({
  usePathname: () => "/done",
}));

vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({
    openDetail: vi.fn(),
    openCapture: vi.fn(),
    openCommand: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = () => {};
  useStore.setState({
    tasks: [makeTask({ lifecycle: "dropped", title: "Old idea" })],
    labels: [],
    hydrated: true,
    viewMode: "list",
  });
});

describe("Done page Dropped section", () => {
  it("shows the list-mode Dropped disclosure", () => {
    render(<DonePage />);
    expect(screen.getByRole("button", { name: /^dropped/i })).toBeInTheDocument();
  });

  it("hides the list-mode Dropped disclosure in board mode", () => {
    useStore.setState({ viewMode: "board" });
    render(<DonePage />);
    expect(screen.queryByRole("button", { name: /^dropped/i })).toBeNull();
    expect(screen.getByRole("button", { name: /show dropped/i })).toBeInTheDocument();
  });
});
