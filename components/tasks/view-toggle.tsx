"use client";

import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { Columns3, Rows3 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

/**
 * List ⇄ Board switch in the page header. The board is its own route (its
 * columns are every status, so it can't be a mode of one status page); its
 * "List" side returns to whichever list page was viewed last.
 */
export function ViewToggle({ current }: { current: "list" | "board" }) {
  const pathname = usePathname();
  const lastListHref = useStore((s) => s.lastListHref);
  const setLastListHref = useStore((s) => s.setLastListHref);

  React.useEffect(() => {
    if (current === "list") setLastListHref(pathname);
  }, [current, pathname, setLastListHref]);

  return (
    <div
      role="group"
      aria-label="View"
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-0.5"
    >
      <ViewLink
        href={current === "list" ? pathname : lastListHref}
        active={current === "list"}
        icon={<Rows3 size={13} />}
        label="List"
      />
      <ViewLink
        href="/board"
        active={current === "board"}
        icon={<Columns3 size={13} />}
        label="Board"
      />
    </div>
  );
}

function ViewLink({
  href,
  active,
  icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[12.5px]",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        active
          ? "bg-[var(--surface-muted)] text-[var(--fg)] shadow-[inset_0_0_0_1px_var(--border-strong)]"
          : "text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
      )}
    >
      {icon}
      {label}
    </Link>
  );
}
