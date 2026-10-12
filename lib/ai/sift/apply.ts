import type { Lifecycle, SiftStage, Subtask, Task, TaskEditableField } from "@/lib/domain/types";
import { id as makeId } from "@/lib/utils/ids";
import { STAGE_DEFINITIONS, type StageOutputs } from "./stages";

/**
 * Turn a stage's output into a narrow task patch, honoring `editedFields`.
 *
 * This is the pipeline's half of the "AI never overwrites a user-edited
 * field" invariant (`lib/domain/triage-merge.ts` is the single-shot half
 * and the client's). Each stage touches only its own fields; the repos'
 * narrow SET writes nothing else, so a user edit that lands between two
 * steps survives. `priorityBucket` is derived by the repository when
 * urgency/importance move and the bucket itself is not protected.
 *
 * `labelIds` must already be canonical ids (see `ensureLabelsByName`).
 */
export function stagePatch<S extends SiftStage>(
  task: Task,
  stage: S,
  output: StageOutputs[S],
  extras: { labelIds?: string[] } = {},
): Partial<Task> {
  const protect = (field: TaskEditableField) => task.editedFields.includes(field);
  const patch: Partial<Task> = {};

  switch (stage) {
    case "enrich": {
      const o = output as StageOutputs["enrich"];
      if (!protect("title")) patch.title = o.title;
      if (!protect("description") && o.description !== null) patch.description = o.description;
      if (!protect("nextAction")) patch.nextAction = o.nextAction;
      if (!protect("due")) patch.due = o.dueHint;
      if (!protect("labelIds") && extras.labelIds?.length) patch.labelIds = extras.labelIds;
      break;
    }
    case "prioritize": {
      const o = output as StageOutputs["prioritize"];
      if (!protect("urgency")) patch.urgency = o.urgency;
      if (!protect("importance")) patch.importance = o.importance;
      if (!protect("effort")) patch.effort = o.effort;
      patch.rationale = o.rationale;
      break;
    }
    case "triage": {
      const o = output as StageOutputs["triage"];
      const routed = routeLifecycle(task, o.routing);
      if (routed) patch.lifecycle = routed;
      if (!protect("delegationCandidate")) patch.delegationCandidate = o.delegationCandidate;
      patch.confidence = o.confidence;
      patch.clarifyingQuestion = o.clarifyingQuestion;
      break;
    }
    case "subtasks": {
      const o = output as StageOutputs["subtasks"];
      if (!protect("subtasks") && o.subtasks.length) {
        patch.subtasks = o.subtasks.map(
          (title, order): Subtask => ({ id: makeId("st"), title, done: false, order }),
        );
      }
      break;
    }
    case "plan": {
      const o = output as StageOutputs["plan"];
      patch.plan = { ...o, promptVersion: STAGE_DEFINITIONS.plan.promptVersion };
      break;
    }
  }
  return patch;
}

/**
 * Routing is conservative: only an untouched inbox task moves, and only to
 * `waiting` or `someday`. Promoting into Focus (`active`) is the user's
 * call, and a task the user already filed stays where they put it.
 */
export function routeLifecycle(
  task: Pick<Task, "lifecycle">,
  routing: StageOutputs["triage"]["routing"],
): Lifecycle | null {
  if (task.lifecycle !== "inbox") return null;
  if (routing === "waiting" || routing === "someday") return routing;
  return null;
}
