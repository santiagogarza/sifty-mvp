import { safeNextPath } from "@/lib/auth/safe-next";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://sifty.vercel.app";

describe("safeNextPath", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(safeNextPath("/settings/billing", ORIGIN)).toBe("/settings/billing");
    expect(safeNextPath("/redeem?code=sifty-abc#x", ORIGIN)).toBe("/redeem?code=sifty-abc#x");
  });

  it("falls back to /today for empty, relative, or absolute values", () => {
    expect(safeNextPath(undefined, ORIGIN)).toBe("/today");
    expect(safeNextPath("", ORIGIN)).toBe("/today");
    expect(safeNextPath("today", ORIGIN)).toBe("/today");
    expect(safeNextPath("https://evil.com/x", ORIGIN)).toBe("/today");
    expect(safeNextPath("//evil.com/x", ORIGIN)).toBe("/today");
  });

  it("rejects backslash and control-character smuggling", () => {
    for (const bad of [
      "/\\evil.com",
      "/\\\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "/%5Cevil.com".replace("%5C", "\\"),
      "/\u0000/evil.com",
    ]) {
      expect(safeNextPath(bad, ORIGIN)).toBe("/today");
    }
  });

  it("percent-encoded tricks resolve on-origin or are rejected, never off-origin", () => {
    for (const enc of ["/%5Cevil.com", "/%09/evil.com", "/%2F%2Fevil.com"]) {
      const out = safeNextPath(enc, ORIGIN);
      expect(new URL(out, ORIGIN).origin).toBe(ORIGIN);
    }
  });
});
