import { safeNext } from "@/components/auth/auth-form";
import { describe, expect, it } from "vitest";

describe("safeNext", () => {
  it("keeps same-origin paths", () => {
    expect(safeNext("/today")).toBe("/today");
    expect(safeNext("/settings/billing?tab=plan#x")).toBe("/settings/billing?tab=plan#x");
  });

  it("falls back to /today for anything that could leave the origin", () => {
    for (const bad of [
      undefined,
      "",
      "today",
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\\\\evil.example",
      "/foo\\bar",
      "javascript:alert(1)",
      "/%5Cevil.example",
    ]) {
      expect(safeNext(bad), String(bad)).toBe("/today");
    }
  });
});
