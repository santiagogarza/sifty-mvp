import { viewModeForPath } from "@/components/tasks/use-view-mode";
import { describe, expect, it } from "vitest";

describe("view mode", () => {
  it("treats a missing key, bad JSON, and unknown values as List", () => {
    expect(viewModeForPath(null, "/inbox")).toBe("list");
    expect(viewModeForPath("{", "/inbox")).toBe("list");
    expect(viewModeForPath(JSON.stringify({ "/inbox": "kanban" }), "/inbox")).toBe("list");
    expect(viewModeForPath(JSON.stringify(["board"]), "/inbox")).toBe("list");
  });

  it("does not let one route's choice affect another", () => {
    const raw = JSON.stringify({ "/inbox": "board", "/today": "list" });
    expect(viewModeForPath(raw, "/inbox")).toBe("board");
    expect(viewModeForPath(raw, "/today")).toBe("list");
    expect(viewModeForPath(raw, "/focus")).toBe("list");
  });
});
