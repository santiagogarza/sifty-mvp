/**
 * The keyboard shortcuts that actually exist, as data, so the cheat sheet
 * and the README can never list a binding the app does not implement.
 * `keys` is a sequence of chords; a chord is the keys pressed together.
 * `MOD` renders as ⌘ on Apple platforms and Ctrl elsewhere. Group titles
 * and descriptions live in the `shell.shortcuts` catalog under each `id`.
 */

export const MOD = "MOD" as const;

export type ShortcutId =
  | "capture"
  | "submitCapture"
  | "closeCapture"
  | "commandPalette"
  | "moveDown"
  | "moveUp"
  | "openTask"
  | "closeOverlay"
  | "snoozeTomorrow"
  | "snoozeNextWeek"
  | "selectRange"
  | "duplicate"
  | "answerQuestion"
  | "pickAnswer"
  | "letSiftyDecide"
  | "toggleSheet";

export type ShortcutGroupId = "capture" | "navigate" | "tasks" | "decisions" | "help";

export interface Shortcut {
  id: ShortcutId;
  keys: ReadonlyArray<ReadonlyArray<string>>;
  /** Alternative chords that do the same thing. */
  also?: ReadonlyArray<ReadonlyArray<string>>;
}

export interface ShortcutGroup {
  id: ShortcutGroupId;
  shortcuts: ReadonlyArray<Shortcut>;
}

export const SHORTCUT_GROUPS: ReadonlyArray<ShortcutGroup> = [
  {
    id: "capture",
    shortcuts: [
      { id: "capture", keys: [["c"]] },
      { id: "submitCapture", keys: [[MOD, "↵"]] },
      { id: "closeCapture", keys: [["Esc"]] },
    ],
  },
  {
    id: "navigate",
    shortcuts: [
      { id: "commandPalette", keys: [["/"]], also: [[MOD, "K"]] },
      { id: "moveDown", keys: [["↓"]], also: [["j"]] },
      { id: "moveUp", keys: [["↑"]], also: [["k"]] },
      { id: "openTask", keys: [["↵"]] },
      { id: "closeOverlay", keys: [["Esc"]] },
    ],
  },
  {
    id: "tasks",
    shortcuts: [
      { id: "snoozeTomorrow", keys: [["s"], ["t"]] },
      { id: "snoozeNextWeek", keys: [["s"], ["w"]] },
      { id: "selectRange", keys: [["Shift", "click"]] },
      { id: "duplicate", keys: [["Shift", "D"]] },
    ],
  },
  {
    id: "decisions",
    shortcuts: [
      { id: "answerQuestion", keys: [["↵"]] },
      { id: "pickAnswer", keys: [["1"]], also: [["2"], ["3"], ["4"]] },
      { id: "letSiftyDecide", keys: [["d"]] },
    ],
  },
  {
    id: "help",
    shortcuts: [{ id: "toggleSheet", keys: [["?"]] }],
  },
];

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "");
}
