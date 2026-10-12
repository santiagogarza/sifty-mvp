import type { Repos } from "@/lib/db/repos";
import type { AiRunRollupRow } from "@/lib/db/repos/types";
import { findModelSpec } from "./models";

/**
 * Admin cost view over `ai_runs`.
 *
 * Cross-tenant by design (the creator's spend dashboard), so the page that
 * renders it must gate on `session.user.isCreator`. The rollups come from
 * the repository; this module only shapes them and labels the keys. Costs
 * are the registry list prices recorded per run (`cost_cents`), so the
 * numbers agree with the AI Gateway dashboard to within rounding and keep
 * working in `direct` mode.
 */

export const COST_REPORT_DAYS = 30;

export interface CostReportTotals {
  runs: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

export interface CostReportRow extends AiRunRollupRow {
  label: string;
}

export interface CostReport {
  since: string;
  days: number;
  totals: CostReportTotals;
  byDay: CostReportRow[];
  byStage: CostReportRow[];
  byModel: CostReportRow[];
  byUser: CostReportRow[];
}

export async function buildCostReport(
  repos: Repos,
  opts: { now?: Date; days?: number } = {},
): Promise<CostReport> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? COST_REPORT_DAYS;
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const [byDay, byStage, byModel, byUser] = await Promise.all([
    repos.aiRuns.rollup({ since, by: "day" }),
    repos.aiRuns.rollup({ since, by: "stage" }),
    repos.aiRuns.rollup({ since, by: "model" }),
    repos.aiRuns.rollup({ since, by: "user" }),
  ]);

  const users = await Promise.all(
    byUser.map(async (row) => ({
      ...row,
      label: (await repos.users.getById(row.key))?.email ?? `${row.key} (deleted)`,
    })),
  );

  return {
    since: since.toISOString(),
    days,
    totals: sumRows(byDay),
    byDay: byDay.map((row) => ({ ...row, label: row.key })),
    byStage: byStage.map((row) => ({ ...row, label: row.key })),
    byModel: byModel.map((row) => ({
      ...row,
      label: findModelSpec(row.key)?.label ?? row.key,
    })),
    byUser: users,
  };
}

export function sumRows(rows: AiRunRollupRow[]): CostReportTotals {
  return rows.reduce<CostReportTotals>(
    (acc, row) => ({
      runs: acc.runs + row.runs,
      failed: acc.failed + row.failed,
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
      costCents: acc.costCents + row.costCents,
    }),
    { runs: 0, failed: 0, inputTokens: 0, outputTokens: 0, costCents: 0 },
  );
}

/** "$0.0042" for sub-cent totals, "$12.30" once it matters. */
export function formatUsd(cents: number): string {
  const usd = cents / 100;
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
