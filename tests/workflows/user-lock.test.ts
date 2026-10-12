import { acquireUserSlot } from "@/lib/workflows/user-lock";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The slot lock is plain code over `createHook` + `getConflict`, so it can
 * be driven without a world by scripting which tokens conflict and when
 * their owners finish.
 */

vi.mock("workflow", () => ({ createHook: vi.fn() }));

type Owner = { returnValue: Promise<unknown> };
/** token → owner run, while that token is held. */
const held = new Map<string, Owner>();
const created: string[] = [];
const disposed: string[] = [];

beforeEach(async () => {
  held.clear();
  created.length = 0;
  disposed.length = 0;
  const { createHook } = await import("workflow");
  vi.mocked(createHook).mockImplementation(((opts: { token: string }) => {
    created.push(opts.token);
    return {
      token: opts.token,
      getConflict: async () => held.get(opts.token) ?? null,
      dispose: () => disposed.push(opts.token),
    };
  }) as unknown as typeof createHook);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("acquireUserSlot", () => {
  it("takes the first free slot without waiting", async () => {
    await acquireUserSlot("sift", "u1", 2);
    expect(created).toEqual(["sift:u1:0"]);
  });

  it("skips a busy slot and takes the next free one", async () => {
    held.set("sift:u1:0", { returnValue: new Promise(() => {}) });
    await acquireUserSlot("sift", "u1", 2);
    expect(created).toEqual(["sift:u1:0", "sift:u1:1"]);
  });

  it("waits on the owners when every slot is busy, then retries", async () => {
    let release!: () => void;
    const owner0 = {
      returnValue: new Promise<void>((r) => {
        release = r;
      }),
    };
    held.set("sift:u1:0", owner0);
    held.set("sift:u1:1", { returnValue: new Promise(() => {}) });

    let acquired = false;
    const run = acquireUserSlot("sift", "u1", 2).then(() => {
      acquired = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(acquired).toBe(false);
    expect(created).toEqual(["sift:u1:0", "sift:u1:1"]);

    // Owner 0 finishes: its token is released and the retry wins slot 0.
    held.delete("sift:u1:0");
    release();
    await run;
    expect(acquired).toBe(true);
    expect(created).toEqual(["sift:u1:0", "sift:u1:1", "sift:u1:0"]);
  });

  it("a failed owner still releases its slot", async () => {
    held.set("sift:u1:0", { returnValue: Promise.reject(new Error("owner died")) });
    const run = acquireUserSlot("sift", "u1", 1);
    held.delete("sift:u1:0");
    await expect(run).resolves.toMatchObject({ release: expect.any(Function) });
    expect(created).toEqual(["sift:u1:0", "sift:u1:0"]);
  });

  it("release() disposes the slot's hook so the token frees before the run ends", async () => {
    const slot = await acquireUserSlot("sift", "u1", 1);
    expect(disposed).toEqual([]);
    slot.release();
    expect(disposed).toEqual(["sift:u1:0"]);
  });

  it("slots are scoped per user and per scope", async () => {
    held.set("sift:u1:0", { returnValue: new Promise(() => {}) });
    await acquireUserSlot("sift", "u2", 1);
    await acquireUserSlot("ping", "u1", 1);
    expect(created).toEqual(["sift:u2:0", "ping:u1:0"]);
  });
});
