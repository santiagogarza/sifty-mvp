"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import * as React from "react";

interface Shortcut {
  keys: React.ReactNode;
  label: string;
}

const SECTIONS: Array<{ title: string; items: Shortcut[] }> = [
  {
    title: "Anywhere",
    items: [
      { keys: <Kbd>C</Kbd>, label: "Capture a task" },
      {
        keys: (
          <>
            <Kbd>/</Kbd> <Kbd>⌘K</Kbd>
          </>
        ),
        label: "Search and jump",
      },
      { keys: <Kbd>?</Kbd>, label: "Show keyboard shortcuts" },
    ],
  },
  {
    title: "Task list",
    items: [
      {
        keys: (
          <>
            <Kbd>J</Kbd> <Kbd>K</Kbd>
          </>
        ),
        label: "Move between tasks",
      },
      { keys: <Kbd>↵</Kbd>, label: "Open task" },
      { keys: <Chord second="T" />, label: "Snooze until tomorrow" },
      { keys: <Chord second="W" />, label: "Snooze until this weekend" },
      { keys: <Chord second="N" />, label: "Snooze until next week" },
      { keys: <Chord second="D" />, label: "Snooze until a date…" },
    ],
  },
];

function Chord({ second }: { second: string }) {
  return (
    <>
      <Kbd>S</Kbd>
      <span className="text-[11px] text-[var(--fg-subtle)]">then</span>
      <Kbd>{second}</Kbd>
    </>
  );
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent placement="top" className="w-[min(440px,calc(100vw-32px))] p-5">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription className="sr-only">
          Keys that work across Sifty and in task lists.
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-5">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <div className="text-eyebrow mb-2">{section.title}</div>
              <dl className="flex flex-col gap-1.5">
                {section.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-4">
                    <dt className="text-[13px] text-[var(--fg-muted)]">{item.label}</dt>
                    <dd className="flex items-center gap-1">{item.keys}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
