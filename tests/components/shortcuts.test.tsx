// @vitest-environment jsdom
import { GlobalKeyboard, globalShortcutFor } from "@/components/app-shell/keyboard";
import { SHORTCUT_GROUPS } from "@/components/app-shell/shortcuts";
import { ShortcutsSheet } from "@/components/app-shell/shortcuts-sheet";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/** SIF-20: `?` opens the cheat sheet, except while typing. */

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

  it("Escape closes it", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ShortcutsSheet open onOpenChange={onOpenChange} />);
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
