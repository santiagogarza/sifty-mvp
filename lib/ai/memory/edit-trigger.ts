import type { Repos } from "@/lib/db/repos";
import type { Task, TaskEditableField } from "@/lib/domain/types";
import { reportError } from "@/lib/observability/report-error";
import { startWorkflow } from "@/lib/workflows/dispatch";
import { memoryFromEdit } from "@/lib/workflows/memory-from-edit";
import { detectContradictions } from "./contradictions";
import type { MemoryExtractInput } from "./execute";

/**
 * `PATCH /api/tasks/:id` calls this after a successful write. If the edit
 * reversed the sift's output on a signal field, one `memoryFromEdit` run
 * is started — once per task and sift, tracked by a `memory.extracted`
 * task event, so a user who keeps tuning a task does not keep paying.
 * Never throws: an edit must succeed whether or not extraction starts.
 */

export const SIGNAL_FIELDS_FOR_EDIT: readonly TaskEditableField[] = [
  "urgency",
  "importance",
  "effort",
  "due",
  "delegationCandidate",
  "labelIds",
];

export async function maybeExtractFromEdit(
  repos: Repos,
  args: {
    userId: string;
    before: Task;
    patch: Partial<Task>;
    editedFields: readonly TaskEditableField[] | undefined;
    offline: boolean;
  },
): Promise<{ started: boolean; reason?: string }> {
  const contradictions = detectContradictions(args.before, args.patch, args.editedFields);
  if (!contradictions.length) return { started: false, reason: "no_contradiction" };
  const siftId = args.before.siftId as string;

  try {
    const recent = await repos.taskEvents.listForTask(args.userId, args.before.id, 20);
    if (recent.some((e) => e.kind === "memory.extracted" && e.payload.siftId === siftId)) {
      return { started: false, reason: "already_extracted" };
    }
    await repos.taskEvents.append(args.userId, {
      id: `evt_mem_${siftId}`,
      taskId: args.before.id,
      kind: "memory.extracted",
      payload: { siftId, fields: contradictions.map((c) => c.field) },
    });
    const input: MemoryExtractInput = {
      userId: args.userId,
      taskId: args.before.id,
      siftId,
      trigger: "edit",
      contradictions,
      modelPreference: null,
      offline: args.offline,
    };
    await startWorkflow(memoryFromEdit, [input]);
    return { started: true };
  } catch (err) {
    reportError(err, {
      area: "memory.edit-trigger",
      userId: args.userId,
      tags: { taskId: args.before.id, siftId },
    });
    return { started: false, reason: "error" };
  }
}

/** Whether a PATCH is worth the extra read that contradiction detection needs. */
export function editTouchesSignalField(editedFields: readonly TaskEditableField[] | undefined) {
  return !!editedFields?.some((f) => SIGNAL_FIELDS_FOR_EDIT.includes(f));
}
