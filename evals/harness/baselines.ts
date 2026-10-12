import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SiftStage } from "@/lib/domain/types";
import type { CostBaseline } from "./cost";
import type { Fingerprints } from "./fingerprints";

/**
 * Committed baselines under `evals/baselines/`. Each is plain JSON so a
 * diff in a PR shows exactly which prompt, check, or price moved.
 *
 * - `prompt-fingerprints.json` — hash per prompt version (bump policy).
 * - `offline-rubrics.json` — pass/fail of every soft check for every
 *   capture under the offline heuristic. Deterministic, so compared
 *   exactly: a flip in either direction has to be acknowledged by
 *   re-recording (`pnpm eval:update`).
 * - `cost-baseline.json` — registry prices plus the estimated (offline)
 *   and measured (online) per-stage cost of the golden set.
 */

export const BASELINES_DIR = path.resolve(process.cwd(), "evals/baselines");
export const RESULTS_DIR = path.resolve(process.cwd(), "evals/.results");

export type RubricBaseline = Record<string, Partial<Record<SiftStage, Record<string, boolean>>>>;

const FILES = {
  fingerprints: "prompt-fingerprints.json",
  rubrics: "offline-rubrics.json",
  cost: "cost-baseline.json",
} as const;

export function readFingerprints(): Fingerprints {
  return readJson<Fingerprints>(FILES.fingerprints, {});
}
export function writeFingerprints(value: Fingerprints): void {
  writeJson(FILES.fingerprints, sortKeys(value));
}

export function readRubricBaseline(): RubricBaseline {
  return readJson<RubricBaseline>(FILES.rubrics, {});
}
export function writeRubricBaseline(value: RubricBaseline): void {
  writeJson(FILES.rubrics, value);
}

export function readCostBaseline(): CostBaseline {
  return readJson<CostBaseline>(FILES.cost, { prices: {}, estimated: null, measured: null });
}
export function writeCostBaseline(value: CostBaseline): void {
  writeJson(FILES.cost, value);
}

export function writeResult(name: string, value: unknown): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, name);
  writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function readJson<T>(name: string, fallback: T): T {
  const file = path.join(BASELINES_DIR, name);
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function writeJson(name: string, value: unknown): void {
  mkdirSync(BASELINES_DIR, { recursive: true });
  writeFileSync(path.join(BASELINES_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function sortKeys<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) as T;
}
