"use client";

import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { useTaskCounts } from "@/lib/store/selectors";
import { cn } from "@/lib/utils/cn";
import { Brain, Inbox, ListTodo, PauseCircle, Settings, Sun, Target } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  count?: number;
}

export function Sidebar() {
  const pathname = usePathname();
  const counts = useTaskCounts();

  const items: NavItem[] = [
    { label: "Today", href: "/today", icon: Sun, count: counts.today },
    { label: "Focus", href: "/focus", icon: Target, count: counts.focus },
    { label: "Inbox", href: "/inbox", icon: Inbox, count: counts.inbox },
    { label: "Waiting", href: "/waiting", icon: PauseCircle, count: counts.waiting },
    { label: "Someday", href: "/someday", icon: ListTodo, count: counts.someday },
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
                {item.count && item.count > 0 ? (
                  <span className="text-num text-[11.5px] tabular-nums text-[var(--fg-subtle)]">
                    {item.count}
                  </span>
                ) : null}
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

function SiftyMark() {
  return (
    <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-[6px] bg-[var(--accent)]/15 border border-[var(--accent)]/30">
      <span className="absolute inset-0 rounded-[6px] bg-[var(--accent)] opacity-10 blur-[6px]" />
      <span className="relative size-2 rounded-full bg-[var(--accent)]" />
    </span>
  );
}
