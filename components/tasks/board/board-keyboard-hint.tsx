"use client";

export function BoardKeyboardHint() {
  return (
    <div
      className="hidden md:flex items-center justify-center gap-4 py-3 text-[11px] text-[var(--fg-subtle)]"
      aria-hidden="true"
    >
      <span>
        <kbd className="kbd">j</kbd>/<kbd className="kbd">k</kbd> within column
      </span>
      <span>
        <kbd className="kbd">←</kbd>/<kbd className="kbd">→</kbd> across columns
      </span>
      <span>
        <kbd className="kbd">⇧</kbd>+<kbd className="kbd">←</kbd>/<kbd className="kbd">→</kbd> move
      </span>
      <span>
        <kbd className="kbd">Enter</kbd> open
      </span>
    </div>
  );
}
