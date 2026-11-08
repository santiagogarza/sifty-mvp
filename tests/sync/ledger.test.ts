import { parseLedger } from "@/lib/store/sync";
import { describe, expect, it } from "vitest";

describe("sync ledger parsing", () => {
  it("reads the list shape this build writes", () => {
    const ledger = parseLedger(
      JSON.stringify({
        lastUserId: "user_1",
        dirty: { tasks: ["task_a"], memories: [], labels: ["label_b"] },
        deleted: { tasks: ["task_gone"], memories: [] },
      }),
    );
    expect(ledger).toEqual({
      lastUserId: "user_1",
      dirty: { tasks: ["task_a"], memories: [], labels: ["label_b"] },
      deleted: { tasks: ["task_gone"], memories: [] },
    });
  });

  it("keeps the dirty ids from the id-keyed shape another build left behind", () => {
    const ledger = parseLedger(
      JSON.stringify({
        lastUserId: "user_1",
        dirty: { tasks: { task_a: ["title"] }, memories: {}, labels: {} },
        deleted: { tasks: [], memories: [] },
        rejected: { tasks: [], memories: [], labels: [] },
      }),
    );
    expect(ledger?.dirty).toEqual({ tasks: ["task_a"], memories: [], labels: [] });
    expect(Array.isArray(ledger?.dirty.tasks)).toBe(true);
  });

  it("falls back to empty lists for missing or junk fields", () => {
    expect(parseLedger(JSON.stringify({ dirty: { tasks: "nope" }, deleted: null }))).toEqual({
      lastUserId: null,
      dirty: { tasks: [], memories: [], labels: [] },
      deleted: { tasks: [], memories: [] },
    });
    expect(parseLedger("not json")).toBeNull();
    expect(parseLedger("null")).toBeNull();
  });
});
