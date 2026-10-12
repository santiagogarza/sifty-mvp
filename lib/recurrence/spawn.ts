import { createHash } from "node:crypto";
import type { Repos } from "@/lib/db/repos";
import { buildNextInstance } from "@/lib/domain/recurrence";
import type { Lifecycle, Task } from "@/lib/domain/types";

/**
 * Spawn the next instance of a recurring task when one is completed.
 *
 * Idempotent by construction: the successor id is derived from the
 * completed instance's id and its `completedAt`, so a replayed PATCH or
 * two devices reporting the same completion land on one row, which is
 * returned untouched — it may have moved on (been edited, even completed
 * and spawned its own successor) and must not be reset to a copy of its
 * parent. Un-completing and completing again is a new completion (new
 * `completedAt`), but it spawns nothing while the series still has an
 * open successor, so a mis-click never doubles the series; a successor the
 * user deleted, on the other hand, no longer blocks it, and neither does an
 * older instance the user re-opened.
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
    /**
     * The user's calendar day of completion (`YYYY-MM-DD`), as the client
     * saw it. Falls back to today in `timeZone`, then UTC.
     */
    completedOn?: string | null;
    /** IANA zone of the completing client. */
    timeZone?: string | null;
    /** Spawn the successor `pending` (owed a sift) even from a `ready` parent. */
    needsSift?: boolean;
    now?: Date;
  },
): Promise<{ task: Task; created: boolean } | null> {
  const { parent } = args;
  if (!parent.recurrence) return null;

  const seriesId = parent.seriesId ?? parent.id;
  const nextId = nextInstanceId(parent.id, parent.completedAt);
  const existing = await repos.tasks.get(userId, nextId);
  // A row that already carries its series is a finished spawn. One without
  // it is a stub whose copy patch never landed; fall through and apply it.
  if (existing?.seriesId) return { task: existing, created: false };
  if (!existing) {
    // Only this instance's own successor (spawned from it, by lineage, not
    // by timestamp) stands in for a new one. An older open row — the
    // previous instance un-completed by a mis-click — must not stop the
    // series from moving forward.
    const open = (
      await repos.tasks.listBySeries(userId, seriesId, { lifecycles: OPEN_LIFECYCLES })
    ).find((t) => t.id !== parent.id && t.recurrence?.spawnedFrom === parent.id);
    if (open) return { task: open, created: false };
  }

  const lifecycle: Lifecycle =
    args.previousLifecycle === "done" || args.previousLifecycle === "dropped"
      ? "active"
      : args.previousLifecycle;
  const { create, patch, editedFields } = buildNextInstance(parent, {
    id: nextId,
    completedOn: args.completedOn ?? localDay(args.now ?? new Date(), args.timeZone ?? null),
    lifecycle,
    needsSift: args.needsSift,
  });

  // create() is idempotent for the owner: a concurrent spawn of the same
  // parent gets the same row back and applies the same patch.
  const stub = existing ?? (await repos.tasks.create(userId, create));
  const task = (await repos.tasks.update(userId, stub.id, patch, { editedFields })) ?? stub;
  return { task, created: true };
}

const OPEN_LIFECYCLES: readonly Lifecycle[] = ["inbox", "active", "waiting", "someday"];

/**
 * Deterministic successor id for one completion of one instance. Client
 * ids are `prefix_<base36>`; a sha256 prefix is unguessable enough and
 * matches the wire pattern.
 */
export function nextInstanceId(parentId: string, completedAt: string | null): string {
  const digest = createHash("sha256")
    .update(`next:${parentId}:${completedAt ?? ""}`)
    .digest("hex");
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
