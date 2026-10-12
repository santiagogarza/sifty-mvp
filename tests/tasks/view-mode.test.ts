import { parseViewMode } from "@/components/tasks/use-view-mode";
import { describe, expect, it } from "vitest";

describe("parseViewMode", () => {
  it("treats missing, unknown, and non-board values as list", () => {
    expect(parseViewMode(null)).toBe("list");
    expect(parseViewMode(undefined)).toBe("list");
    expect(parseViewMode("")).toBe("list");
    expect(parseViewMode("list")).toBe("list");
    expect(parseViewMode("BOARD")).toBe("list");
    expect(parseViewMode("{")).toBe("list");
    expect(parseViewMode('{"/inbox":"board"}')).toBe("list");
    expect(parseViewMode("board")).toBe("board");
  });
});
