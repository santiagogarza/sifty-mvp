// @vitest-environment jsdom
import { AppFrame } from "@/components/app-shell/app-frame";
import { GlobalKeyboard, globalShortcutFor } from "@/components/app-shell/keyboard";
import { SHORTCUT_GROUPS } from "@/components/app-shell/shortcuts";
import { ShortcutsSheet } from "@/components/app-shell/shortcuts-sheet";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/** SIF-20: `?` opens the cheat sheet, except while typing. */

// AppFrame pulls in Next's router and the sync hook; stub both so the
// frame mounts in jsdom without a server.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/store/sync", () => ({
  useServerSync: () => ({ hydrated: true, error: null, rejected: 0 }),
}));
vi.mock("@/lib/ai/run-triage", () => ({ runTriage: vi.fn(), isTriageInFlight: () => false }));

afterEach(() => {
  cleanup();
});

function key(
  k: string,
  target: EventTarget | null = document.body,
  mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {},
) {
  return { key: k, metaKey: false, ctrlKey: false, altKey: false, target, ...mods };
}

describe("globalShortcutFor", () => {
  it("maps ? to the shortcuts sheet outside fields", () => {
    expect(globalShortcutFor(key("?"))).toBe("shortcuts");
    expect(globalShortcutFor(key("c"))).toBe("capture");
    expect(globalShortcutFor(key("/"))).toBe("command");
    expect(globalShortcutFor(key("k", document.body, { metaKey: true }))).toBe("command");
  });

  it("ignores ? while typing in a textarea, input, or contenteditable", () => {
    const textarea = document.createElement("textarea");
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.setAttribute("role", "textbox");
    expect(globalShortcutFor(key("?", textarea))).toBeNull();
    expect(globalShortcutFor(key("?", input))).toBeNull();
    expect(globalShortcutFor(key("?", editable))).toBeNull();
    // Cmd/Ctrl+K still works from a field.
    expect(globalShortcutFor(key("k", input, { ctrlKey: true }))).toBe("command");
  });

  it("ignores single keys with a modifier held", () => {
    expect(globalShortcutFor(key("?", document.body, { altKey: true }))).toBeNull();
    expect(globalShortcutFor(key("c", document.body, { ctrlKey: true }))).toBeNull();
  });

  it("ignores auto-repeat from a held key", () => {
    expect(globalShortcutFor({ ...key("?"), repeat: true })).toBeNull();
    expect(globalShortcutFor({ ...key("c"), repeat: true })).toBeNull();
    expect(globalShortcutFor({ ...key("?"), repeat: false })).toBe("shortcuts");
  });
});

describe("AppFrame overlays", () => {
  it("c from the open cheat sheet replaces it with capture instead of stacking", async () => {
    // ThemeProvider reads the system scheme; jsdom has no matchMedia.
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
    const user = userEvent.setup();
    render(
      <AppFrame>
        <div>page</div>
      </AppFrame>,
    );

    await user.keyboard("?");
    expect(screen.getByRole("dialog", { name: "Shortcuts" })).toBeInTheDocument();

    await user.keyboard("c");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Shortcuts" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "Capture" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});

describe("GlobalKeyboard", () => {
  it("calls the opener on ? and leaves a textarea alone", async () => {
    const user = userEvent.setup();
    const onShortcuts = vi.fn();
    render(
      <>
        <GlobalKeyboard onCapture={vi.fn()} onCommand={vi.fn()} onShortcuts={onShortcuts} />
        <textarea aria-label="Draft" />
      </>,
    );

    await user.keyboard("?");
    expect(onShortcuts).toHaveBeenCalledTimes(1);

    const draft = screen.getByLabelText("Draft");
    await user.click(draft);
    await user.keyboard("?");
    expect(onShortcuts).toHaveBeenCalledTimes(1);
    expect(draft).toHaveValue("?");
  });
});

describe("ShortcutsSheet", () => {
  it("lists the real shortcuts, including ? itself", () => {
    render(<ShortcutsSheet open onOpenChange={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Shortcuts" })).toBeInTheDocument();
    expect(screen.getByText("Capture a task")).toBeInTheDocument();
    expect(screen.getByText("Command palette")).toBeInTheDocument();
    expect(screen.getByText("Show or hide this sheet")).toBeInTheDocument();
    for (const group of SHORTCUT_GROUPS) {
      for (const s of group.shortcuts) {
        expect(screen.getByText(s.description)).toBeInTheDocument();
      }
    }
  });

  it("renders alternatives with 'or' and sequences with 'then', never arrows as a sequence", () => {
    render(<ShortcutsSheet open onOpenChange={vi.fn()} />);
    const down = screen.getByText("Move down the list").closest("li")!;
    expect(down).toHaveTextContent(/↓\s*or\s*j/);
    expect(down).not.toHaveTextContent("then");
    const snooze = screen.getByText("Snooze until tomorrow").closest("li")!;
    expect(snooze).toHaveTextContent(/s\s*then\s*t/);
  });

  it("Escape closes it", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ShortcutsSheet open onOpenChange={onOpenChange} />);
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
