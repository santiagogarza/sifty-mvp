import type { DelegationCandidate, Task } from "./types";

/** Trim and collapse empty/whitespace-only names to null. */
export function normalizeAssigneeName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

export function assigneeDisplayValue(task: Pick<Task, "assigneeName">): string | null {
  return normalizeAssigneeName(task.assigneeName);
}

/**
 * Assignee shown on rows and cards: only when the task is delegated to a
 * person and a name is set — a delegation *recommendation* is not a person.
 */
export function displayedAssigneeName(
  task: Pick<Task, "delegationCandidate" | "assigneeName">,
): string | null {
  return task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
}

export function delegationLabel(d: DelegationCandidate): string {
  return { self: "Me", ai: "AI agent", person: "Person", unsure: "Unsure" }[d];
}

/** Closed meta cell: assignee name when Person + set, else delegation label. */
export function delegationMetaLabel(
  task: Pick<Task, "delegationCandidate" | "assigneeName">,
): string {
  if (task.delegationCandidate === "person") {
    const name = assigneeDisplayValue(task);
    if (name) return name;
  }
  return delegationLabel(task.delegationCandidate);
}

/** Muted closed value when Person is selected but no name yet. */
export function delegationValueMuted(
  task: Pick<Task, "delegationCandidate" | "assigneeName">,
): boolean {
  return task.delegationCandidate === "person" && !assigneeDisplayValue(task);
}
