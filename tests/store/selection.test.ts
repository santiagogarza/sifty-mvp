import { rangeSelection } from "@/lib/utils/selection";
import { describe, expect, it } from "vitest";

/**
 * SIF-22 range-selection contract: Shift+click selects the contiguous,
 * inclusive range between the anchor (last plain click) and the target,
 * in visible order, in either direction. A missing or stale anchor
 * collapses to just the target — never a surprise range.
 */

const IDS = ["a", "b", "c", "d", "e", "f"];

describe("rangeSelection", () => {
  it("selects the inclusive range downward from the anchor", () => {
    expect(rangeSelection(IDS, "b", "e")).toEqual(["b", "c", "d", "e"]);
  });

  it("selects the inclusive range upward when the target is above the anchor", () => {
    expect(rangeSelection(IDS, "e", "b")).toEqual(["b", "c", "d", "e"]);
  });

  it("collapses to the single row when anchor and target are the same", () => {
    expect(rangeSelection(IDS, "c", "c")).toEqual(["c"]);
  });

  it("selects only the target when there is no anchor", () => {
    expect(rangeSelection(IDS, null, "d")).toEqual(["d"]);
  });

  it("selects only the target when the anchor left the visible list", () => {
    expect(rangeSelection(IDS, "gone", "d")).toEqual(["d"]);
  });

  it("selects nothing when the target is not visible", () => {
    expect(rangeSelection(IDS, "b", "gone")).toEqual([]);
  });

  it("spans the full list edge to edge", () => {
    expect(rangeSelection(IDS, "a", "f")).toEqual(IDS);
  });
});
