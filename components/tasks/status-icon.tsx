import type { Lifecycle } from "@/lib/domain/types";
import { CircleCheck, CircleOff, Inbox, ListTodo, PauseCircle, Target } from "lucide-react";
import type * as React from "react";

/**
 * One icon per status, shared by the sidebar, the Status picker, and the
 * filing strip so "where did it go" is answered by shape as well as word.
 */
export const STATUS_ICONS: Record<
  Lifecycle,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  inbox: Inbox,
  active: Target,
  waiting: PauseCircle,
  someday: ListTodo,
  done: CircleCheck,
  dropped: CircleOff,
};

export function StatusIcon({
  status,
  size = 14,
  className,
}: {
  status: Lifecycle;
  size?: number;
  className?: string;
}) {
  const Icon = STATUS_ICONS[status];
  return <Icon size={size} className={className} />;
}
