"use client";

import { useTaskCounts } from "@/lib/store/selectors";
import { cn } from "@/lib/utils/cn";
import { Inbox, Plus, Settings, Sun, Target } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

/**
 * Mobile bottom navigation. Five slots: Today, Focus, Capture, Inbox, Settings.
 * The Capture slot is visually distinct — a single warm pill — because it's
 * the most-used action.
 */
export function BottomNav({ onCapture }: { onCapture: () => void }) {
  const pathname = usePathname();
  const counts = useTaskCounts();

  const items = [
    { href: "/today", label: "Today", icon: Sun, count: counts.today },
    { href: "/focus", label: "Focus", icon: Target, count: counts.focus },
    null,
    { href: "/inbox", label: "Inbox", icon: Inbox, count: counts.inbox },
    { href: "/settings", label: "Settings", icon: Settings, count: 0 },
  ] as const;

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30
      border-t border-[var(--border)] bg-[var(--bg-elevated)]/95 backdrop-blur
      pb-[max(env(safe-area-inset-bottom),8px)] pt-2"
    >
      <ul className="grid grid-cols-5 items-end px-2">
        {items.map((item, i) => {
          if (!item) {
            return (
              <li key="capture" className="flex justify-center -mt-6">
                <button
                  type="button"
                  aria-label="Capture task"
                  onClick={onCapture}
                  className="size-12 rounded-full bg-[var(--accent)] text-[var(--accent-fg)]
                  flex items-center justify-center shadow-[0_8px_24px_-6px_oklch(0%_0_0/0.5)]
                  active:translate-y-[1px] transition-transform"
                >
                  <Plus size={20} strokeWidth={2.2} />
                </button>
              </li>
            );
          }
          const Icon = item.icon;
          const active = pathname?.startsWith(item.href);
          return (
            <li key={item.href} className="flex justify-center">
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-1.5 rounded-[var(--radius-sm)]",
                  "text-[10.5px]",
                  active ? "text-[var(--fg)]" : "text-[var(--fg-subtle)]",
                )}
              >
                <span className="relative inline-flex">
                  <Icon size={18} />
                  {item.count > 0 ? (
                    <span className="absolute -top-1 -right-2 min-w-[14px] h-[14px] rounded-full bg-[var(--accent)] text-[var(--accent-fg)] text-[9px] font-medium px-1 inline-flex items-center justify-center text-num">
                      {item.count > 99 ? "99+" : item.count}
                    </span>
                  ) : null}
                </span>
                <span className="leading-none">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
