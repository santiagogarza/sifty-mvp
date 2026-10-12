import { buildCostReport, formatTokens, formatUsd, sumRows } from "@/lib/ai/cost-report";
import { SIFT_ACCOUNTING_STAGE } from "@/lib/db/repos/types";
import { describe, expect, it } from "vitest";
import { getTestRepos } from "../setup";

function run(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    userId,
    taskId: null,
    promptVersion: "enrich.v1",
    stage: "enrich",
    model: "anthropic/claude-haiku-4.5",
    transport: "gateway",
    status: "succeeded" as const,
    durationMs: 100,
    inputTokens: 1000,
    outputTokens: 100,
    costCents: 0.15,
    offline: false,
    error: null,
    ...overrides,
  };
}

describe("buildCostReport", () => {
  it("totals every tenant and labels models and accounts", async () => {
    const repos = getTestRepos();
    const a = await repos.users.create({
      email: "a@example.com",
      displayName: "A",
      isCreator: true,
    });
    const b = await repos.users.create({
      email: "b@example.com",
      displayName: "B",
      isCreator: false,
    });

    await repos.aiRuns.insert(run(a.id));
    await repos.aiRuns.insert(
      run(a.id, { stage: "plan", model: "anthropic/claude-sonnet-4.5", costCents: 2 }),
    );
    await repos.aiRuns.insert(
      run(b.id, { status: "failed", error: "boom", costCents: null, inputTokens: null }),
    );
    // The accounting row of a sift carries no cost but is still a run.
    await repos.aiRuns.insert(
      run(b.id, {
        stage: SIFT_ACCOUNTING_STAGE,
        siftId: "sift_1",
        model: "sifty.workflow",
        transport: "workflow",
        costCents: 0,
        inputTokens: null,
        outputTokens: null,
      }),
    );

    const report = await buildCostReport(repos, { days: 7 });
    expect(report.days).toBe(7);
    expect(report.totals).toEqual({
      runs: 4,
      failed: 1,
      inputTokens: 2000,
      outputTokens: 300,
      costCents: 2.15,
    });
    expect(report.byDay).toHaveLength(1);
    expect(report.byStage.map((r) => r.key)).toEqual(["plan", "enrich", SIFT_ACCOUNTING_STAGE]);
    expect(report.byModel.map((r) => r.label)).toEqual([
      "Claude Sonnet 4.5",
      "Claude Haiku 4.5",
      "sifty.workflow",
    ]);
    expect(report.byUser.map((r) => [r.label, r.runs])).toEqual([
      ["a@example.com", 2],
      ["b@example.com", 2],
    ]);
  });

  it("names deleted accounts by id", async () => {
    const repos = getTestRepos();
    const u = await repos.users.create({
      email: "gone@example.com",
      displayName: "G",
      isCreator: false,
    });
    await repos.aiRuns.insert(run(u.id));
    // Simulate a row that outlived its user (the cascade removes rows in
    // Postgres; the label fallback is still the safe path).
    repos.users.getById = async () => null;
    const report = await buildCostReport(repos);
    expect(report.byUser[0]!.label).toBe(`${u.id} (deleted)`);
  });

  it("formats sub-cent spend without rounding it to zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.42)).toBe("$0.0042");
    expect(formatUsd(1230)).toBe("$12.30");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(3_250_000)).toBe("3.25M");
    expect(sumRows([])).toEqual({
      runs: 0,
      failed: 0,
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
    });
  });
});
