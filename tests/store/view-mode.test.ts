import { selectTodayTasks } from "@/lib/store/selectors";
import {
  migrateSiftyState,
  partializeSiftyState,
  registerSyncHooks,
  useStore,
} from "@/lib/store/store";
import { beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], memories: [], viewModes: {}, hydrated: true });
  registerSyncHooks(null);
});

describe("viewModes", () => {
  it("defaults to list when a route has no choice stored", () => {
    expect(useStore.getState().viewModes["/inbox"] ?? "list").toBe("list");
  });

  it("remembers List vs Board per route", () => {
    const { setViewMode } = useStore.getState();
    setViewMode("/inbox", "board");
    setViewMode("/focus", "list");
    expect(useStore.getState().viewModes).toEqual({ "/inbox": "board", "/focus": "list" });
  });

  it("persists viewModes", () => {
    useStore.getState().setViewMode("/today", "board");
    expect(partializeSiftyState(useStore.getState()).viewModes).toEqual({ "/today": "board" });
  });

  it("migrates a v3 snapshot by adding an empty viewModes map", () => {
    const task = { id: "t1", title: "keep" };
    const next = migrateSiftyState(
      { tasks: [task], labels: [], memories: [], preferredModelId: "m" },
      3,
    );
    expect(next.viewModes).toEqual({});
    expect(next.tasks?.[0]).toEqual(task);
  });
});

describe("setLifecycle", () => {
  it("sets completedAt when entering Done and clears it when leaving", () => {
    const task = useStore.getState().createTask({ sourceText: "Ship the board" });
    expect(task.completedAt).toBeNull();

    useStore.getState().setLifecycle(task.id, "done");
    const done = useStore.getState().tasks.find((item) => item.id === task.id)!;
    expect(done.lifecycle).toBe("done");
    expect(done.completedAt).toBeTruthy();

    useStore.getState().setLifecycle(task.id, "active");
    const back = useStore.getState().tasks.find((item) => item.id === task.id)!;
    expect(back.lifecycle).toBe("active");
    expect(back.completedAt).toBeNull();
  });

  it("notifies sync as an update, not a create", () => {
    const calls: boolean[] = [];
    registerSyncHooks({
      taskUpserted: (_task, opts) => calls.push(opts.created),
      taskDeleted: () => {},
      labelEnsured: () => {},
      memoryUpserted: () => {},
      memoryDeleted: () => {},
      waitForTask: async () => {},
      isTaskDirty: () => false,
    });
    const task = useStore.getState().createTask({ sourceText: "File me" });
    calls.length = 0;
    useStore.getState().setLifecycle(task.id, "active");
    expect(calls).toEqual([false]);
  });

  it("drops a task from Today when it is filed to Someday", () => {
    const task = useStore.getState().createTask({ sourceText: "Maybe later" });
    useStore.getState().updateTask(task.id, { priorityBucket: "do_now" });
    expect(selectTodayTasks(useStore.getState().tasks).map((item) => item.id)).toContain(task.id);

    useStore.getState().setLifecycle(task.id, "someday");
    expect(selectTodayTasks(useStore.getState().tasks).map((item) => item.id)).not.toContain(
      task.id,
    );
  });
});
