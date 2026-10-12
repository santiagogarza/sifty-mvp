"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import * as React from "react";
import { MOD, SHORTCUT_GROUPS, type Shortcut, isApplePlatform } from "./shortcuts";

/**
 * Keyboard cheat sheet. Opened with `?` (or from the command palette).
 * Plain rows: chord, one-line meaning. Recognition over recall — the point
 * is to never have to leave the product to remember `j`/`k`.
 */
export function ShortcutsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [mod, setMod] = React.useState("Ctrl");
  React.useEffect(() => {
    setMod(isApplePlatform() ? "⌘" : "Ctrl");
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent placement="top" aria-describedby={undefined}>
        <div className="px-5 pt-4 pb-3 border-b border-[var(--border)]">
          <DialogTitle>Shortcuts</DialogTitle>
          <DialogDescription className="mt-0.5 text-[12px]">
            Work the list without touching the mouse.
          </DialogDescription>
        </div>
        {/* Short viewports: the groups scroll inside the dialog, since the
            modal scroll-lock would otherwise strand the lower rows. */}
        <div className="grid max-h-[70dvh] grid-cols-1 gap-x-8 gap-y-4 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="text-eyebrow mb-1.5">{group.title}</h3>
              <ul className="flex flex-col">
                {group.shortcuts.map((shortcut) => (
                  <li
                    key={shortcut.description}
                    className="flex items-center justify-between gap-4 py-1.5 text-[13px]"
                  >
                    <span className="text-[var(--fg-muted)]">{shortcut.description}</span>
                    <Chords shortcut={shortcut} mod={mod} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Chords({ shortcut, mod }: { shortcut: Shortcut; mod: string }) {
  const render = (seq: ReadonlyArray<ReadonlyArray<string>>) =>
    seq.map((chord, i) => (
      <React.Fragment key={chord.join("+")}>
        {i > 0 ? <span className="text-[10.5px] text-[var(--fg-subtle)]">then</span> : null}
        <span className="inline-flex items-center gap-0.5">
          {chord.map((key) => (
            <Kbd key={key}>{key === MOD ? mod : key}</Kbd>
          ))}
        </span>
      </React.Fragment>
    ));
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {render(shortcut.keys)}
      {shortcut.also ? (
        <>
          <span className="text-[10.5px] text-[var(--fg-subtle)]">or</span>
          {render(shortcut.also)}
        </>
      ) : null}
    </span>
  );
}
