import {
  type NavColumn,
  adjacentStatus,
  locate,
  navigate,
} from "@/components/tasks/board-navigation";
import { BOARD_STATUSES } from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

/** Inbox [a, b, c] · Focus [] · Waiting on [d] · Someday [e, f] · Done []. */
const columns: NavColumn[] = [
  { status: "inbox", tasks: [{ id: "a" }, { id: "b" }, { id: "c" }] },
  { status: "active", tasks: [] },
  { status: "waiting", tasks: [{ id: "d" }] },
  { status: "someday", tasks: [{ id: "e" }, { id: "f" }] },
  { status: "done", tasks: [] },
];

describe("navigate", () => {
  it("selects the first card on the board when nothing (or a stale id) is selected", () => {
    expect(navigate(columns, null, "right")).toBe("a");
    expect(navigate(columns, "gone", "down")).toBe("a");
    const leadingEmpty: NavColumn[] = [{ status: "inbox", tasks: [] }, ...columns.slice(2)];
    expect(navigate(leadingEmpty, null, "left")).toBe("d");
    expect(navigate([{ status: "inbox", tasks: [] }], null, "down")).toBeNull();
  });

  it("moves within a column and clamps at both ends", () => {
    expect(navigate(columns, "a", "down")).toBe("b");
    expect(navigate(columns, "c", "down")).toBe("c");
    expect(navigate(columns, "b", "up")).toBe("a");
    expect(navigate(columns, "a", "up")).toBe("a");
  });

  it("jumps across empty columns and keeps the row when it can", () => {
    expect(navigate(columns, "a", "right")).toBe("d");
    // Row 2 doesn't exist in Waiting on: clamp to its last card.
    expect(navigate(columns, "c", "right")).toBe("d");
    expect(navigate(columns, "d", "right")).toBe("e");
    expect(navigate(columns, "f", "left")).toBe("d");
    expect(navigate(columns, "d", "left")).toBe("a");
  });

  it("stays put when there is no card further that way", () => {
    expect(navigate(columns, "a", "left")).toBe("a");
    expect(navigate(columns, "e", "right")).toBe("e");
  });
});

describe("locate", () => {
  it("finds a card's column and row", () => {
    expect(locate(columns, "f")).toEqual({ column: 3, row: 1 });
    expect(locate(columns, "gone")).toBeNull();
    expect(locate(columns, null)).toBeNull();
  });
});

describe("adjacentStatus", () => {
  it("files one column over and stops at either end of the board", () => {
    expect(adjacentStatus(BOARD_STATUSES, "inbox", "right")).toBe("active");
    expect(adjacentStatus(BOARD_STATUSES, "someday", "right")).toBe("done");
    expect(adjacentStatus(BOARD_STATUSES, "active", "left")).toBe("inbox");
    expect(adjacentStatus(BOARD_STATUSES, "inbox", "left")).toBeNull();
    expect(adjacentStatus(BOARD_STATUSES, "done", "right")).toBeNull();
    expect(adjacentStatus(BOARD_STATUSES, "dropped", "left")).toBeNull();
  });
});
