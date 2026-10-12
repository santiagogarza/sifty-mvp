/**
 * The keyboard shortcuts that actually exist, as data, so the cheat sheet
 * and the README can never list a binding the app does not implement.
 * `keys` is a sequence of chords; a chord is the keys pressed together.
 * `MOD` renders as ⌘ on Apple platforms and Ctrl elsewhere.
 */

export const MOD = "MOD" as const;

export interface Shortcut {
  keys: ReadonlyArray<ReadonlyArray<string>>;
  description: string;
  /** Alternative chords that do the same thing. */
  also?: ReadonlyArray<ReadonlyArray<string>>;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: ReadonlyArray<Shortcut>;
}

export const SHORTCUT_GROUPS: ReadonlyArray<ShortcutGroup> = [
  {
    title: "Capture",
    shortcuts: [
      { keys: [["c"]], description: "Capture a task" },
      { keys: [[MOD, "↵"]], description: "Submit the capture" },
      { keys: [["Esc"]], description: "Close capture (your draft is kept)" },
    ],
  },
  {
    title: "Navigate",
    shortcuts: [
      { keys: [["/"]], also: [[MOD, "K"]], description: "Command palette" },
      { keys: [["↓"]], also: [["j"]], description: "Move down the list" },
      { keys: [["↑"]], also: [["k"]], description: "Move up the list" },
      { keys: [["↵"]], description: "Open the highlighted task" },
      { keys: [["Esc"]], description: "Close the open overlay or clear a selection" },
    ],
  },
  {
    title: "Tasks",
    shortcuts: [
      { keys: [["s"], ["t"]], description: "Snooze until tomorrow" },
      { keys: [["s"], ["w"]], description: "Snooze until next week" },
      { keys: [["Shift", "click"]], description: "Select a range of tasks" },
      { keys: [["Shift", "D"]], description: "Duplicate the open task" },
    ],
  },
  {
    title: "Help",
    shortcuts: [{ keys: [["?"]], description: "Show or hide this sheet" }],
  },
];

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "");
}
