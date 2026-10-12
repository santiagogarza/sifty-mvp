import { readFileSync } from "node:fs";
import path from "node:path";
import type { OpenTaskSummary } from "@/lib/ai/sift/stages";
import { DELEGATION_CANDIDATE, EFFORT, PLAN_EXECUTOR, SIFT_STAGES } from "@/lib/domain/types";
import { z } from "zod";

/**
 * Shape of `evals/golden/captures.json`.
 *
 * A capture is a realistic raw input (what a user typed, optional context,
 * the labels and preferences the pipeline would see) plus the properties a
 * good sift has at each stage. Expectations are ranges and allow-lists, not
 * exact strings: two good models should both pass.
 *
 * `injection` marks adversarial captures. Its markers are strings the task
 * text tries to smuggle into the output; the `no-injection` check fails if
 * any produced field (title, next action, labels, subtasks, question, plan
 * approach, connectors) contains one. Fields that may legitimately quote
 * the input (description, rationale) are exempt.
 */

const Range = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const Count = z.tuple([z.number().int().min(0).max(5), z.number().int().min(0).max(5)]);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CAPTURE_CATEGORIES = ["work", "personal", "vague", "multi", "adversarial"] as const;
export type CaptureCategory = (typeof CAPTURE_CATEGORIES)[number];

export const ROUTINGS = ["inbox", "active", "waiting", "someday"] as const;

export const EnrichExpectation = z.object({
  /** "none": no due date; "any": some due date; an ISO date: exactly that. */
  due: z.union([z.literal("none"), z.literal("any"), IsoDate]).optional(),
  /** The output must not carry this date (adversarial date injection). */
  dueNot: IsoDate.optional(),
  /** Every suggested label must be one of these or an existing label (case-insensitive). */
  labelsFrom: z.array(z.string()).optional(),
  titleMaxWords: z.number().int().min(1).max(20).optional(),
});

export const PrioritizeExpectation = z.object({
  urgency: Range.optional(),
  importance: Range.optional(),
  effort: z.array(z.enum(EFFORT)).min(1).optional(),
});

export const TriageExpectation = z.object({
  routing: z.array(z.enum(ROUTINGS)).min(1).optional(),
  delegation: z.array(z.enum(DELEGATION_CANDIDATE)).min(1).optional(),
  /** "required": the capture is too thin to act on without one question. */
  question: z.enum(["required", "forbidden"]).optional(),
});

export const SubtasksExpectation = z.object({
  count: Count.optional(),
});

export const PlanExpectation = z.object({
  executor: z.array(z.enum(PLAN_EXECUTOR)).min(1).optional(),
  readyForAi: z.boolean().optional(),
  connectorsFrom: z.array(z.string()).optional(),
});

export const Expectations = z.object({
  enrich: EnrichExpectation.optional(),
  prioritize: PrioritizeExpectation.optional(),
  triage: TriageExpectation.optional(),
  subtasks: SubtasksExpectation.optional(),
  plan: PlanExpectation.optional(),
});
export type Expectations = z.infer<typeof Expectations>;

const OpenTask = z.object({
  title: z.string().min(1),
  lifecycle: z.enum(["inbox", "active", "waiting", "someday", "done", "dropped"]),
  due: IsoDate.nullable(),
  urgency: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  effort: z.enum(EFFORT),
}) satisfies z.ZodType<OpenTaskSummary>;

export const GoldenCapture = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case id"),
  category: z.enum(CAPTURE_CATEGORIES),
  /** Why this capture is in the set; shown in failure messages. */
  note: z.string().optional(),
  sourceText: z.string().min(1).max(2000),
  sourceContext: z.string().max(4000).nullable().default(null),
  recentLabels: z.array(z.string().min(1)).max(8).default([]),
  preferences: z.array(z.string().min(1)).max(6).default([]),
  openTasks: z.array(OpenTask).max(25).default([]),
  injection: z
    .object({
      markers: z.array(z.string().min(2)).min(1),
    })
    .optional(),
  expect: Expectations.default({}),
});
export type GoldenCapture = z.infer<typeof GoldenCapture>;

export const GoldenSet = z.object({
  /** Fixed "today" every run uses, so relative dates in captures resolve the same way forever. */
  today: IsoDate,
  captures: z.array(GoldenCapture).min(40).max(80),
});
export type GoldenSet = z.infer<typeof GoldenSet>;

export const GOLDEN_SET_PATH = path.resolve(process.cwd(), "evals/golden/captures.json");

export function parseGoldenSet(raw: unknown): GoldenSet {
  const set = GoldenSet.parse(raw);
  const ids = new Set<string>();
  for (const capture of set.captures) {
    if (ids.has(capture.id)) throw new Error(`duplicate capture id "${capture.id}"`);
    ids.add(capture.id);
    if (capture.category === "adversarial" && !capture.injection) {
      throw new Error(`adversarial capture "${capture.id}" needs injection.markers`);
    }
    for (const stage of SIFT_STAGES) {
      const exp = capture.expect[stage];
      if (!exp) continue;
      for (const [key, value] of Object.entries(exp)) {
        if (Array.isArray(value) && value.length === 2 && typeof value[0] === "number") {
          const [lo, hi] = value as [number, number];
          if (lo > hi) throw new Error(`"${capture.id}" ${stage}.${key}: min ${lo} > max ${hi}`);
        }
      }
    }
  }
  return set;
}

export function loadGoldenSet(file: string = GOLDEN_SET_PATH): GoldenSet {
  return parseGoldenSet(JSON.parse(readFileSync(file, "utf8")));
}
