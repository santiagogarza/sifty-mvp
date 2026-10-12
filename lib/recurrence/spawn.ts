import { createHash } from "node:crypto";
import type { Repos } from "@/lib/db/repos";
import { buildNextInstance } from "@/lib/domain/recurrence";
import type { Lifecycle, Task } from "@/lib/domain/types";

/**
 * Spawn the next instance of a recurring task when one is completed.
 *
 * Idempotent by construction: the next instance's id is derived from the
 * completed instance's id, so a replayed PATCH, two devices completing the
 * same task, or an un-complete/re-complete all land on the same row. When
 * it already exists it is returned untouched — it may have moved on (been
 * edited, even completed and spawned its own successor) and must not be
 * reset to a copy of its parent.
 *
 * The copy carries the parent's sift output (priority, labels, plan,
 * rationale) and is created `ready`, so a recurring task costs AI once.
 */
export async function spawnNextInstance(
  repos: Repos,
  userId: string,
  args: {
    /** The instance just completed (post-update row). */
    parent: Task;
    /** Where the parent lived before completion; the next instance lands there. */
    previousLifecycle: Lifecycle;
    /** IANA zone of the completing client; UTC when absent. */
    timeZone?: string | null;
    now?: Date;
  },
): Promise<{ task: Task; created: boolean } | null> {
  const { parent } = args;
  if (!parent.recurrence) return null;

  const nextId = nextInstanceId(parent.id);
  const existing = await repos.tasks.get(userId, nextId);
  if (existing) return { task: existing, created: false };

  const lifecycle: Lifecycle =
    args.previousLifecycle === "done" || args.previousLifecycle === "dropped"
      ? "active"
      : args.previousLifecycle;
  const { create, patch, editedFields } = buildNextInstance(parent, {
    id: nextId,
    completedOn: localDay(args.now ?? new Date(), args.timeZone ?? null),
    lifecycle,
  });

  // create() is idempotent for the owner: a concurrent spawn of the same
  // parent gets the same row back and applies the same patch.
  const stub = await repos.tasks.create(userId, create);
  const task = (await repos.tasks.update(userId, stub.id, patch, { editedFields })) ?? stub;
  return { task, created: true };
}

/**
 * Deterministic successor id. Client ids are `prefix_<base36>`; a sha256
 * prefix is unguessable enough and matches the wire pattern.
 */
export function nextInstanceId(parentId: string): string {
  const digest = createHash("sha256").update(`next:${parentId}`).digest("hex");
  return `task_r${digest.slice(0, 20)}`;
}

/** `YYYY-MM-DD` of `now` in `timeZone` (UTC when null or unknown). */
export function localDay(now: Date, timeZone: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
