import {
  DEFAULT_EXECUTION_POLICY,
  applyReadOnlyRule,
  resolveExecutionPolicy,
} from "@/lib/executions/policy";
import { describe, expect, it } from "vitest";
import { getTestRepos } from "../setup";

const readOnly = { readOnly: true };
const sideEffects = { readOnly: false };

async function user() {
  const repos = getTestRepos();
  const u = await repos.users.create({
    email: "p@example.com",
    displayName: "P",
    isCreator: false,
  });
  const task = await repos.tasks.create(u.id, { sourceText: "Reply to Ana", sourceContext: null });
  return { repos, userId: u.id, taskId: task.id };
}

describe("execution policy (D9)", () => {
  it("defaults to draft_then_approve", async () => {
    const { repos, userId, taskId } = await user();
    const r = await resolveExecutionPolicy(repos, userId, {
      taskId,
      connector: "gmail",
      executor: sideEffects,
    });
    expect(r).toEqual({ policy: "draft_then_approve", source: "default", downgraded: null });
    expect(DEFAULT_EXECUTION_POLICY).toBe("draft_then_approve");
  });

  it("resolves request > task > connector > default", async () => {
    const { repos, userId, taskId } = await user();
    await repos.executionPolicies.set(userId, "connector", "gmail", "ask_first");
    let r = await resolveExecutionPolicy(repos, userId, {
      taskId,
      connector: "gmail",
      executor: sideEffects,
    });
    expect(r).toMatchObject({ policy: "ask_first", source: "connector" });

    await repos.executionPolicies.set(userId, "task", taskId, "draft_then_approve");
    r = await resolveExecutionPolicy(repos, userId, {
      taskId,
      connector: "gmail",
      executor: sideEffects,
    });
    expect(r).toMatchObject({ policy: "draft_then_approve", source: "task" });

    r = await resolveExecutionPolicy(repos, userId, {
      taskId,
      connector: "gmail",
      executor: sideEffects,
      requested: "ask_first",
    });
    expect(r).toMatchObject({ policy: "ask_first", source: "request" });

    // A connector policy only applies when the executor needs that connector.
    await repos.executionPolicies.clear(userId, "task", taskId);
    r = await resolveExecutionPolicy(repos, userId, {
      taskId,
      connector: null,
      executor: sideEffects,
    });
    expect(r).toMatchObject({ policy: "draft_then_approve", source: "default" });
  });

  it("honours auto only for read-only executors and reports the downgrade", async () => {
    const { repos, userId, taskId } = await user();
    await repos.executionPolicies.set(userId, "task", taskId, "auto");
    const research = await resolveExecutionPolicy(repos, userId, {
      taskId,
      connector: null,
      executor: readOnly,
    });
    expect(research).toEqual({ policy: "auto", source: "task", downgraded: null });

    const sender = await resolveExecutionPolicy(repos, userId, {
      taskId,
      connector: "gmail",
      executor: sideEffects,
    });
    expect(sender).toEqual({
      policy: "draft_then_approve",
      source: "task",
      downgraded: { from: "auto", to: "draft_then_approve" },
    });
    // Even an explicit request cannot force it.
    expect(applyReadOnlyRule("auto", sideEffects).policy).toBe("draft_then_approve");
    expect(applyReadOnlyRule("ask_first", sideEffects)).toEqual({
      policy: "ask_first",
      downgraded: null,
    });
  });

  it("policies are per tenant", async () => {
    const { repos, userId, taskId } = await user();
    const other = await repos.users.create({
      email: "q@example.com",
      displayName: "Q",
      isCreator: false,
    });
    await repos.executionPolicies.set(other.id, "task", taskId, "auto");
    const r = await resolveExecutionPolicy(repos, userId, {
      taskId,
      connector: null,
      executor: readOnly,
    });
    expect(r.source).toBe("default");
    expect(await repos.executionPolicies.list(userId, "task", { limit: 10 })).toEqual([]);
    expect(await repos.executionPolicies.list(other.id, "task", { limit: 10 })).toHaveLength(1);
  });
});
