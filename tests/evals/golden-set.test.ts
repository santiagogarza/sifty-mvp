import { CAPTURE_CATEGORIES, loadGoldenSet, parseGoldenSet } from "@/evals/golden/schema";
import { describe, expect, it } from "vitest";

describe("golden capture set", () => {
  const set = loadGoldenSet();

  it("has 40-60 captures with unique kebab-case ids", () => {
    expect(set.captures.length).toBeGreaterThanOrEqual(40);
    expect(set.captures.length).toBeLessThanOrEqual(60);
    expect(new Set(set.captures.map((c) => c.id)).size).toBe(set.captures.length);
  });

  it("covers every category with at least 8 captures", () => {
    for (const category of CAPTURE_CATEGORIES) {
      const n = set.captures.filter((c) => c.category === category).length;
      expect(n, category).toBeGreaterThanOrEqual(8);
    }
  });

  it("gives every adversarial capture injection markers that appear in its text", () => {
    for (const c of set.captures.filter((c) => c.category === "adversarial")) {
      expect(c.injection, c.id).toBeDefined();
      const haystack = `${c.sourceText}\n${c.sourceContext ?? ""}`.toLowerCase();
      for (const marker of c.injection!.markers) {
        expect(haystack.includes(marker.toLowerCase()), `${c.id}: marker "${marker}" in text`).toBe(
          true,
        );
      }
    }
  });

  it("pins today to a Monday so weekday phrases resolve as the expectations assume", () => {
    expect(new Date(`${set.today}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it("states at least one expectation per capture", () => {
    for (const c of set.captures) {
      expect(Object.keys(c.expect).length, c.id).toBeGreaterThan(0);
    }
  });

  it("rejects duplicate ids", () => {
    const dup = {
      today: "2026-10-12",
      captures: Array.from({ length: 40 }, () => ({
        id: "same-id",
        category: "work",
        sourceText: "x",
        expect: {},
      })),
    };
    expect(() => parseGoldenSet(dup)).toThrow(/duplicate capture id/);
  });

  it("rejects adversarial captures without markers and inverted ranges", () => {
    const base = set.captures.slice(0, 40).map((c) => ({ ...c }));
    const noMarkers = base.map((c, i) =>
      i === 0 ? { ...c, category: "adversarial", injection: undefined } : c,
    );
    expect(() => parseGoldenSet({ today: set.today, captures: noMarkers })).toThrow(
      /needs injection.markers/,
    );
    const inverted = base.map((c, i) =>
      i === 0 ? { ...c, expect: { prioritize: { urgency: [0.9, 0.1] } } } : c,
    );
    expect(() => parseGoldenSet({ today: set.today, captures: inverted })).toThrow(
      /min 0.9 > max 0.1/,
    );
  });
});
