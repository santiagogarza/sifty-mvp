import { taskPatchColumns } from "@/lib/db/repos/task-columns";
import type { Task } from "@/lib/domain/types";
import { describe, expect, it } from "vitest";

/**
 * The Postgres task update must write only the columns the patch names.
 * A full-row read-modify-write would let a client's narrow edit overwrite
 * fields written server-side in between (agent brief, triage result).
 */

const now = new Date("2026-10-12T00:00:00.000Z");

const existing: Task = {
  id: "task_1",
  sourceText: "Write the launch post",
  sourceContext: null,
  title: "Write the launch post",
  description: null,
  nextAction: null,
  lifecycle: "inbox",
  aiStatus: "ready",
  aiError: null,
  aiAttempts: 1,
  urgency: 0.4,
  importance: 0.4,
  priorityBucket: "schedule",
  effort: "small",
  due: null,
  delegationCandidate: "self",
  assigneeName: null,
  confidence: 0.7,
  clarifyingQuestion: null,
  rationale: null,
  agentBrief: "# Brief",
  labelIds: [],
  subtasks: [],
  editedFields: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  completedAt: null,
};

describe("taskPatchColumns", () => {
  it("writes only the provided keys plus updatedAt", () => {
    const columns = taskPatchColumns(existing, { title: "Launch post" }, { now });
    expect(columns).toEqual({ title: "Launch post", updatedAt: now });
    expect(columns).not.toHaveProperty("agentBrief");
  });

  it("writes explicit nulls for nullable fields", () => {
    expect(taskPatchColumns(existing, { agentBrief: null, due: null }, { now })).toEqual({
      agentBrief: null,
      due: null,
      updatedAt: now,
    });
  });

  it("unions editedFields with the stored set only when the caller sends some", () => {
    const stored = { ...existing, editedFields: ["title" as const] };
    expect(
      taskPatchColumns(stored, { due: "2026-11-01" }, { editedFields: ["due", "title"], now })
        .editedFields,
    ).toEqual(["title", "due"]);
    expect(taskPatchColumns(stored, { due: "2026-11-01" }, { now })).not.toHaveProperty(
      "editedFields",
    );
  });

  it("derives the priority bucket from the scalars unless set or protected", () => {
    const columns = taskPatchColumns(existing, { urgency: 0.9, importance: 0.9 }, { now });
    expect(columns.urgency).toBe(90);
    expect(columns.priorityBucket).toBe("do_now");

    expect(
      taskPatchColumns(existing, { urgency: 0.9, priorityBucket: "drop" }, { now }).priorityBucket,
    ).toBe("drop");
    expect(
      taskPatchColumns(
        { ...existing, editedFields: ["priorityBucket"] },
        { urgency: 0.9, importance: 0.9 },
        { now },
      ),
    ).not.toHaveProperty("priorityBucket");
  });

  it("tracks completedAt across lifecycle transitions", () => {
    expect(taskPatchColumns(existing, { lifecycle: "done" }, { now }).completedAt).toEqual(now);
    const done = { ...existing, lifecycle: "done" as const, completedAt: "2026-10-05T00:00:00Z" };
    expect(taskPatchColumns(done, { lifecycle: "done" }, { now })).not.toHaveProperty(
      "completedAt",
    );
    expect(taskPatchColumns(done, { lifecycle: "active" }, { now }).completedAt).toBeNull();
    expect(taskPatchColumns(done, { title: "x" }, { now })).not.toHaveProperty("completedAt");
  });
});
