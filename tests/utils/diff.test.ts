import { diffLines, diffStats } from "@/lib/utils/diff";
import { describe, expect, it } from "vitest";

describe("diffLines", () => {
  it("keeps common lines and marks additions and removals", () => {
    const before = "# Notes\n\n- Call Ana\n- Read the lease\n";
    const after = "# Notes\n\n- Call the landlord\n- Read the lease\n- Compare offers\n";
    const lines = diffLines(before, after);
    expect(lines).toEqual([
      { op: "equal", text: "# Notes" },
      { op: "equal", text: "" },
      { op: "remove", text: "- Call Ana" },
      { op: "add", text: "- Call the landlord" },
      { op: "equal", text: "- Read the lease" },
      { op: "add", text: "- Compare offers" },
      { op: "equal", text: "" },
    ]);
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
  });

  it("handles empty sides, identical text, and CRLF", () => {
    expect(diffLines("", "")).toEqual([]);
    expect(diffLines("", "a\nb")).toEqual([
      { op: "add", text: "a" },
      { op: "add", text: "b" },
    ]);
    expect(diffLines("a\nb", "")).toEqual([
      { op: "remove", text: "a" },
      { op: "remove", text: "b" },
    ]);
    expect(diffLines("a\r\nb", "a\nb").every((l) => l.op === "equal")).toBe(true);
    expect(diffStats(diffLines("same", "same"))).toEqual({ added: 0, removed: 0 });
  });

  it("falls back to a whole-text replacement past the line cap", () => {
    const big = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n");
    const lines = diffLines(big, `${big}\nmore`);
    expect(lines.filter((l) => l.op === "equal")).toHaveLength(0);
    expect(diffStats(lines)).toEqual({ added: 2501, removed: 2500 });
  });
});
