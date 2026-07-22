"use client";

import { cn } from "@/lib/utils/cn";
import { Columns3, List } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const LIST_ROUTES = ["/today", "/focus", "/inbox", "/waiting", "/someday"];

export function ViewSwitcher() {
  const pathname = usePathname();
  const search = useSearchParams();
  const boardActive = pathname === "/board";
  const requestedReturn = search.get("from");
  const listHref =
    requestedReturn && LIST_ROUTES.includes(requestedReturn) ? requestedReturn : "/focus";
  const boardHref = `/board?from=${encodeURIComponent(
    LIST_ROUTES.includes(pathname) ? pathname : listHref,
  )}`;

  return (
    <div
      aria-label="Task view"
      className="inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] p-0.5"
    >
      <ViewLink href={listHref} active={!boardActive} label="List">
        <List size={13} />
      </ViewLink>
      <ViewLink href={boardHref} active={boardActive} label="Board">
        <Columns3 size={13} />
      </ViewLink>
    </div>
  );
}

function ViewLink({
  href,
  active,
  label,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-[12px]",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        active
          ? "bg-[var(--surface)] text-[var(--fg)] shadow-[0_1px_2px_oklch(0%_0_0/0.06)]"
          : "text-[var(--fg-subtle)] hover:text-[var(--fg)]",
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </Link>
  );
}
