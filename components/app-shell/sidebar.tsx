"use client";

import { STATUS_ICONS } from "@/components/tasks/status-icon";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Lifecycle } from "@/lib/domain/types";
import { type TaskCounts, useTaskCounts } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { Brain, Columns3, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  count?: number;
}

/** Which count backs each status view. Done deliberately shows no badge. */
const STATUS_COUNT_KEY: Partial<Record<Lifecycle, keyof TaskCounts>> = {
  inbox: "inbox",
  active: "focus",
  waiting: "waiting",
  someday: "someday",
};

export function Sidebar() {
  const pathname = usePathname();
  const counts = useTaskCounts();
  const hydrated = useStore((s) => s.hydrated);

  // Today first (the smart lens / homepage), then Board (the whole pipeline
  // in one view), then the statuses in pipeline order — the same order,
  // words, and icons as the Status picker.
  const items: NavItem[] = [
    { label: "Today", href: "/today", icon: Sun, count: counts.today },
    { label: "Board", href: "/board", icon: Columns3 },
    ...STATUS_VIEWS.map((view) => {
      const countKey = STATUS_COUNT_KEY[view.status];
      return {
        label: view.label,
        href: view.href,
        icon: STATUS_ICONS[view.status],
        count: countKey ? counts[countKey] : undefined,
      };
    }),
  ];

  return (
    <TooltipProvider>
      <aside
        className="hidden md:flex md:flex-col md:gap-6 md:py-6 md:px-3 md:w-[212px] md:shrink-0
        border-r border-[var(--border)] bg-[var(--bg-sunken)]/50
        relative z-10"
      >
        <Link href="/today" className="flex items-center gap-2 px-2.5">
          <SiftyMark />
          <span className="text-[15px] font-medium tracking-[-0.01em]">Sifty</span>
        </Link>

        <nav className="flex flex-col gap-0.5 px-1">
          {items.map((item) => {
            const Icon = item.icon;
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5",
                  "text-[13.5px] text-[var(--fg-muted)]",
                  "transition-colors duration-150 ease-[var(--ease-product)]",
                  "hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
                  active && "bg-[var(--surface-muted)] text-[var(--fg)]",
                )}
              >
                <Icon size={14} className="opacity-80" />
                <span className="flex-1">{item.label}</span>
                {item.count !== undefined ? <NavCount value={item.count} live={hydrated} /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="px-1 mt-1">
          <div className="text-eyebrow px-2 mb-1.5">More</div>
          <div className="flex flex-col gap-0.5">
            <Link
              href="/memory"
              className={cn(
                "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[13.5px]",
                "text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
                pathname === "/memory" && "bg-[var(--surface-muted)] text-[var(--fg)]",
              )}
            >
              <Brain size={14} className="opacity-80" />
              <span>Memory</span>
            </Link>
            <Link
              href="/settings"
              className={cn(
                "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[13.5px]",
                "text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
                pathname === "/settings" && "bg-[var(--surface-muted)] text-[var(--fg)]",
              )}
            >
              <Settings size={14} className="opacity-80" />
              <span>Settings</span>
            </Link>
          </div>
        </div>

        <div className="mt-auto px-2">
          <Tooltip
            label="Pro tip: press / to open the command palette and c to capture."
            side="right"
          >
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 text-[12px] text-[var(--fg-muted)] leading-[1.5]">
              <div className="text-eyebrow mb-1">Tip</div>
              Press <span className="font-mono text-[11px]">c</span> anywhere to capture. Press{" "}
              <span className="font-mono text-[11px]">/</span> to search and navigate.
            </div>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}

/**
 * Count badge that pulses once when the number goes up — the landing cue
 * after a capture or a filing lands in this view.
 *
 * Every increment bumps `pulseKey`, and the key change remounts the span so
 * the CSS animation restarts by construction — no timer flag that can get
 * stuck. `live` gates observation until the store has rehydrated so the
 * initial 0 → N jump on page load doesn't pulse every badge.
 */
function NavCount({ value, live }: { value: number; live: boolean }) {
  const prevRef = React.useRef<number | null>(null);
  const [pulseKey, setPulseKey] = React.useState(0);

  React.useEffect(() => {
    if (!live) return;
    const prev = prevRef.current;
    prevRef.current = value;
    if (prev !== null && value > prev) setPulseKey((k) => k + 1);
  }, [value, live]);

  if (value <= 0) return null;
  return (
    <span
      key={pulseKey}
      className={cn(
        "text-num text-[11.5px] tabular-nums text-[var(--fg-subtle)]",
        pulseKey > 0 && "animate-count-pulse",
      )}
    >
      {value}
    </span>
  );
}

function SiftyMark() {
  return (
    <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-[6px] bg-[var(--accent)]/15 border border-[var(--accent)]/30">
      <span className="absolute inset-0 rounded-[6px] bg-[var(--accent)] opacity-10 blur-[6px]" />
      <span className="relative size-2 rounded-full bg-[var(--accent)]" />
    </span>
  );
}
