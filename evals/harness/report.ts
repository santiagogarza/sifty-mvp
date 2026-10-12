import { appendFileSync } from "node:fs";
import { SIFT_STAGES, type SiftStage } from "@/lib/domain/types";
import { writeResult } from "./baselines";
import type { CostSummary, CostWarning } from "./cost";
import { type EvalMode, describeMode } from "./mode";
import type { CaptureResult } from "./pipeline";
import type { CheckResult } from "./rubrics";

/**
 * One summary per run: pass counts per stage and check, every failed
 * hard check, every soft-check miss, cost warnings. Written to
 * `evals/.results/` (gitignored), appended to the GitHub Actions step
 * summary when there is one, and cost warnings become `::warning::`
 * annotations so they show on the PR without failing it.
 */

export interface CheckRecord extends CheckResult {
  captureId: string;
  stage: SiftStage;
}

export interface RunReport {
  mode: EvalMode;
  results: CaptureResult[];
  checks: CheckRecord[];
  cost: CostSummary;
  costWarnings: CostWarning[];
  startedAt: string;
}

export function collectChecks(
  results: CaptureResult[],
  check: (result: CaptureResult, stage: SiftStage) => CheckResult[],
): CheckRecord[] {
  const records: CheckRecord[] = [];
  for (const result of results) {
    for (const stage of SIFT_STAGES) {
      for (const c of check(result, stage)) {
        records.push({ ...c, captureId: result.capture.id, stage });
      }
    }
  }
  return records;
}

export function passRates(
  checks: CheckRecord[],
): Map<string, { pass: number; total: number; fails: CheckRecord[] }> {
  const rates = new Map<string, { pass: number; total: number; fails: CheckRecord[] }>();
  for (const c of checks) {
    const key = `${c.stage}/${c.check}`;
    const entry = rates.get(key) ?? { pass: 0, total: 0, fails: [] };
    entry.total += 1;
    if (c.pass) entry.pass += 1;
    else entry.fails.push(c);
    rates.set(key, entry);
  }
  return rates;
}

/**
 * The online gate: soft checks for one stage whose pass rate across the
 * captures they applied to is below `rate`, each with its failing captures.
 */
export function softChecksBelow(checks: CheckRecord[], stage: SiftStage, rate: number): string[] {
  const rates = passRates(checks.filter((c) => c.stage === stage && !c.hard));
  const failing: string[] = [];
  for (const [key, r] of rates) {
    if (r.pass / r.total >= rate) continue;
    failing.push(
      `${key}: ${r.pass}/${r.total}\n    ${r.fails.map((f) => `${f.captureId}: ${f.detail}`).join("\n    ")}`,
    );
  }
  return failing;
}

export function renderSummary(report: RunReport): string {
  const lines: string[] = [];
  const hardFails = report.checks.filter((c) => c.hard && !c.pass);
  const softFails = report.checks.filter((c) => !c.hard && !c.pass);
  lines.push(`## Sifty evals — ${describeMode(report.mode)}`);
  lines.push("");
  lines.push(
    `${report.results.length} captures × ${SIFT_STAGES.length} stages · ${report.checks.length} checks · ` +
      `${hardFails.length} hard failures · ${softFails.length} soft misses · ${report.costWarnings.length} cost warnings`,
  );
  lines.push("");

  lines.push("| Stage / check | Pass | Total | Rate |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const [key, rate] of [...passRates(report.checks)].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(
      `| ${key} | ${rate.pass} | ${rate.total} | ${Math.round((rate.pass / rate.total) * 100)}% |`,
    );
  }
  lines.push("");

  if (hardFails.length) {
    lines.push("### Hard failures");
    for (const f of hardFails)
      lines.push(`- **${f.captureId}** ${f.stage}/${f.check}: ${f.detail}`);
    lines.push("");
  }
  if (softFails.length) {
    lines.push("### Soft misses");
    for (const f of softFails) lines.push(`- ${f.captureId} ${f.stage}/${f.check}: ${f.detail}`);
    lines.push("");
  }

  lines.push(`### Cost (${report.cost.kind}, per sift)`);
  lines.push("| Stage | Model | In | Out | ¢ |");
  lines.push("| --- | --- | ---: | ---: | ---: |");
  for (const stage of SIFT_STAGES) {
    const c = report.cost.stages[stage];
    lines.push(
      `| ${stage} | ${c.model} | ${c.inputTokens} | ${c.outputTokens} | ${c.costCents.toFixed(4)} |`,
    );
  }
  lines.push(`| **total** | | | | **${report.cost.pipelineCostCents.toFixed(4)}** |`);
  lines.push("");
  if (report.costWarnings.length) {
    lines.push("### Cost warnings");
    for (const w of report.costWarnings) lines.push(`- ${w.code}: ${w.message}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function publishReport(report: RunReport): { summaryFile: string; jsonFile: string } {
  const summary = renderSummary(report);
  const stem = report.mode.offline ? "offline" : `online-${report.mode.transport}`;
  const summaryFile = writeResult(`${stem}-summary.md`, `${summary}\n`);
  const jsonFile = writeResult(`${stem}-results.json`, {
    startedAt: report.startedAt,
    mode: report.mode,
    cost: report.cost,
    costWarnings: report.costWarnings,
    checks: report.checks,
    outputs: report.results.map((r) => ({
      id: r.capture.id,
      stages: Object.fromEntries(
        SIFT_STAGES.map((s) => [
          s,
          { output: r.stages[s].output, error: r.stages[s].error, meta: r.stages[s].meta },
        ]),
      ),
    })),
  });

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  if (process.env.GITHUB_ACTIONS) {
    for (const w of report.costWarnings) {
      console.log(`::warning title=eval cost ${w.code}::${w.message}`);
    }
  }
  console.log(`\n${summary}\nSummary: ${summaryFile}\nResults: ${jsonFile}`);
  return { summaryFile, jsonFile };
}
