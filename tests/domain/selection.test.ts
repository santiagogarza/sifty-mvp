import { pruneSelection, rangeBetween } from "@/lib/domain/selection";
import { describe, expect, it } from "vitest";

/** SIF-22: Shift+click range semantics over the visible order. */

const ids = ["a", "b", "c", "d", "e"];

describe("rangeBetween", () => {
  it("selects anchor through target inclusive, in visible order", () => {
    expect(rangeBetween(ids, "b", "e")).toEqual(["b", "c", "d", "e"]);
  });

  it("works upward too", () => {
    expect(rangeBetween(ids, "d", "a")).toEqual(["a", "b", "c", "d"]);
  });

  it("anchor equal to target selects just that row", () => {
    expect(rangeBetween(ids, "c", "c")).toEqual(["c"]);
  });

  it("falls back to the target when the anchor is unknown or gone", () => {
    expect(rangeBetween(ids, null, "c")).toEqual(["c"]);
    expect(rangeBetween(ids, "zzz", "c")).toEqual(["c"]);
  });

  it("returns nothing for a target that is not visible", () => {
    expect(rangeBetween(ids, "a", "zzz")).toEqual([]);
  });
});

describe("pruneSelection", () => {
  it("drops ids that left the view and keeps the rest", () => {
    const next = pruneSelection(new Set(["a", "c", "gone"]), ids);
    expect([...next].sort()).toEqual(["a", "c"]);
  });
});
