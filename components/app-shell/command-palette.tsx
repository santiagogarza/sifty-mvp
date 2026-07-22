"use client";

import { useOpenDetail } from "@/components/app-shell/app-frame";
import { useTheme } from "@/components/app-shell/theme-context";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  ArrowRight,
  Brain,
  Columns3,
  CreditCard,
  Inbox,
  ListTodo,
  PauseCircle,
  Search,
  Settings,
  Sparkles,
  Sun,
  Target,
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

interface CommandItem {
  id: string;
  group: "navigate" | "task" | "system";
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onCapture,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCapture: () => void;
}) {
  const router = useRouter();
  const openDetail = useOpenDetail();
  const { toggle } = useTheme();
  const tasks = useStore((s) => s.tasks);

  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const items: CommandItem[] = React.useMemo(() => {
    const nav: CommandItem[] = [
      {
        id: "go-today",
        group: "navigate",
        label: "Go to Today",
        icon: <Sun size={14} />,
        run: () => router.push("/today"),
      },
      {
        id: "go-focus",
        group: "navigate",
        label: "Go to Focus",
        icon: <Target size={14} />,
        run: () => router.push("/focus"),
      },
      {
        id: "go-inbox",
        group: "navigate",
        label: "Go to Inbox",
        icon: <Inbox size={14} />,
        run: () => router.push("/inbox"),
      },
      {
        id: "go-waiting",
        group: "navigate",
        label: "Go to Waiting",
        icon: <PauseCircle size={14} />,
        run: () => router.push("/waiting"),
      },
      {
        id: "go-someday",
        group: "navigate",
        label: "Go to Someday",
        icon: <ListTodo size={14} />,
        run: () => router.push("/someday"),
      },
      {
        id: "go-board",
        group: "navigate",
        label: "Switch to Board view",
        icon: <Columns3 size={14} />,
        run: () => router.push("/board"),
      },
      {
        id: "go-memory",
        group: "navigate",
        label: "Go to Memory",
        icon: <Brain size={14} />,
        run: () => router.push("/memory"),
      },
      {
        id: "go-settings",
        group: "navigate",
        label: "Settings",
        icon: <Settings size={14} />,
        run: () => router.push("/settings"),
      },
      {
        id: "go-billing",
        group: "navigate",
        label: "Billing",
        icon: <CreditCard size={14} />,
        run: () => router.push("/settings/billing"),
      },
    ];

    const taskItems: CommandItem[] = [
      {
        id: "new-task",
        group: "task",
        label: "Capture new task",
        hint: "C",
        icon: <Sparkles size={14} className="text-[var(--ai)]" />,
        run: onCapture,
      },
    ];

    const taskMatches: CommandItem[] = tasks
      .filter((t) => t.lifecycle !== "done" && t.lifecycle !== "dropped")
      .slice(0, 50)
      .map((t) => ({
        id: t.id,
        group: "task" as const,
        label: t.title,
        icon: <ArrowRight size={14} className="text-[var(--fg-subtle)]" />,
        run: () => openDetail(t.id),
      }));

    const sys: CommandItem[] = [
      {
        id: "toggle-theme",
        group: "system",
        label: "Toggle theme",
        icon: <Sun size={14} />,
        run: () => toggle(),
      },
    ];

    return [...taskItems, ...taskMatches, ...nav, ...sys];
  }, [tasks, router, openDetail, onCapture, toggle]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q));
  }, [query, items]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, []);

  React.useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length, activeIndex]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const item = filtered[activeIndex];
      if (item) {
        item.run();
        onOpenChange(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent placement="top" className="overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search the app, jump to a task, or run a command.
        </DialogDescription>

        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3.5 py-3">
          <Search size={14} className="text-[var(--fg-subtle)]" />
          <input
            value={query}
            placeholder="Search or run a command…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="flex-1 bg-transparent text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:outline-none"
          />
          <span className="hidden sm:flex items-center gap-1 text-[11px] text-[var(--fg-subtle)]">
            <Kbd>esc</Kbd>
          </span>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-10 text-center text-[13px] text-[var(--fg-subtle)]">
              Nothing matches “{query}”.
            </div>
          ) : (
            <CommandGroups
              items={filtered}
              activeIndex={activeIndex}
              setActive={setActiveIndex}
              onPick={(i) => {
                i.run();
                onOpenChange(false);
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CommandGroups({
  items,
  activeIndex,
  setActive,
  onPick,
}: {
  items: CommandItem[];
  activeIndex: number;
  setActive: (i: number) => void;
  onPick: (item: CommandItem) => void;
}) {
  const groups: Array<{ key: CommandItem["group"]; label: string }> = [
    { key: "task", label: "Tasks" },
    { key: "navigate", label: "Navigate" },
    { key: "system", label: "System" },
  ];

  let i = 0;
  return (
    <div className="flex flex-col gap-2 py-1">
      {groups.map((g) => {
        const groupItems = items.filter((it) => it.group === g.key);
        if (groupItems.length === 0) return null;
        return (
          <div key={g.key}>
            <div className="text-eyebrow px-3 pt-1 pb-1.5">{g.label}</div>
            {groupItems.map((it) => {
              const idx = i++;
              const active = idx === activeIndex;
              return (
                <button
                  key={it.id}
                  type="button"
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => onPick(it)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-left",
                    "text-[13.5px] text-[var(--fg)]",
                    "transition-colors duration-100 ease-[var(--ease-product)]",
                    active && "bg-[var(--surface-hover)]",
                  )}
                >
                  <span className="text-[var(--fg-muted)]">{it.icon}</span>
                  <span className="truncate flex-1">{it.label}</span>
                  {it.hint ? <Kbd>{it.hint}</Kbd> : null}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
