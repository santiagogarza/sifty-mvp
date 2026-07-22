"use client";

import { cn } from "@/lib/utils/cn";
import { Columns3, Rows3 } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as React from "react";

/**
 * Subtle List / Board switch.
 *
 * The board is a workspace-wide status view, so it lives at its own route
 * rather than replacing a single tab's list. Switching to the board carries
 * the current path as `?from=` so switching back lands where you started —
 * no client state, deep-linkable, and honest with the back button.
 */
export function ViewToggle() {
  const pathname = usePathname() ?? "/today";
  const search = useSearchParams();
  const onBoard = pathname === "/board";

  // On the board, "List" returns to wherever the switch came from.
  const listHref = onBoard ? (safeReturn(search.get("from")) ?? "/today") : pathname;
  const boardHref = onBoard ? "/board" : `/board?from=${encodeURIComponent(pathname)}`;

  return (
    <div
      role="group"
      aria-label="View"
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-0.5"
    >
      <ToggleLink href={listHref} active={!onBoard} label="List view" icon={<Rows3 size={14} />}>
        List
      </ToggleLink>
      <ToggleLink
        href={boardHref}
        active={onBoard}
        label="Board view"
        icon={<Columns3 size={14} />}
      >
        Board
      </ToggleLink>
    </div>
  );
}

function ToggleLink({
  href,
  active,
  label,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-[12.5px]",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        active
          ? "bg-[var(--surface-hover)] text-[var(--fg)]"
          : "text-[var(--fg-subtle)] hover:text-[var(--fg-muted)]",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
    </Link>
  );
}

/** Only honor same-origin app paths from `?from=` — never an arbitrary URL. */
function safeReturn(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith("/") && !value.startsWith("//") ? value : null;
}
