import { createHash } from "node:crypto";
import {
  AgentBriefOutput,
  BRIEF_PROMPT_VERSION,
  BRIEF_SYSTEM_PROMPT,
  BRIEF_TEMPERATURE,
  buildBriefUserPrompt,
} from "@/lib/ai/agent-brief";
import {
  MEMORY_PROMPT_VERSION,
  MEMORY_SYSTEM_PROMPT,
  MEMORY_TEMPERATURE,
  MemoryExtractionOutput,
  buildMemoryUserPrompt,
} from "@/lib/ai/memory/extract";
import { type PlanContext, toCandidate } from "@/lib/ai/plan/context";
import {
  DAILY_PLAN_PROMPT_VERSION,
  DAILY_PLAN_TEMPERATURE,
  DailyPlanOutput,
  dailyPlanSystem,
  dailyPlanUser,
} from "@/lib/ai/plan/stage";
import { TRIAGE_SYSTEM_PROMPT, buildTriageUserPrompt } from "@/lib/ai/prompts";
import { STAGE_DEFINITIONS } from "@/lib/ai/sift/stages";
import { TRIAGE_TEMPERATURE } from "@/lib/ai/triage-agent";
import { TRIAGE_PROMPT_VERSION, TriageOutput } from "@/lib/ai/triage-schema";
import { SIFT_STAGES } from "@/lib/domain/types";
import { asSchema } from "ai";
import type { z } from "zod";
import { contextFor, taskFromCapture } from "./context";

/**
 * One fingerprint per prompt version: a hash over the system prompt, the
 * user prompt rendered against a fixed capture, the output JSON schema, and
 * the temperature. Anything that changes what the model sees or must
 * return changes the hash.
 *
 * `evals/baselines/prompt-fingerprints.json` records the hash each version
 * shipped with. The `prompt-versions` eval fails when a version's hash
 * moved (prompt edited without a bump) or a new version has no recorded
 * hash (bumped, but the eval was not run). That is the enforcement half of
 * the bump policy in `lib/ai/prompts.ts`.
 */

export type Fingerprints = Record<string, string>;

export const PROMPT_VERSION_RE = /^[a-z]+\.v\d+$/;

const CANONICAL_CAPTURE = {
  id: "fingerprint-canonical",
  category: "work" as const,
  sourceText: "Draft the investor update by Friday and send it to the board",
  sourceContext: "Board meeting is the following Tuesday.",
  recentLabels: ["Work", "Writing"],
  preferences: ["I avoid deep work after 4pm"],
  openTasks: [
    {
      title: "Fix checkout 500s",
      lifecycle: "active" as const,
      due: "2026-10-12",
      urgency: 0.95,
      importance: 0.9,
      effort: "medium" as const,
    },
  ],
  expect: {},
};
const CANONICAL_TODAY = "2026-10-12";

export function computeFingerprints(): Fingerprints {
  const out: Fingerprints = {};
  const task = {
    ...taskFromCapture(CANONICAL_CAPTURE, CANONICAL_TODAY),
    subtasks: [{ id: "st_1", title: "Outline the update", done: false, order: 0 }],
    delegationCandidate: "self" as const,
  };
  const ctx = contextFor(CANONICAL_CAPTURE, task, CANONICAL_TODAY);

  for (const stage of SIFT_STAGES) {
    const def = STAGE_DEFINITIONS[stage];
    out[def.promptVersion] = hash({
      system: def.system,
      user: def.user(ctx),
      schema: asSchema(def.schema as z.ZodTypeAny).jsonSchema,
      temperature: def.temperature,
    });
  }

  out[TRIAGE_PROMPT_VERSION] = hash({
    system: TRIAGE_SYSTEM_PROMPT,
    user: buildTriageUserPrompt({
      sourceText: CANONICAL_CAPTURE.sourceText,
      sourceContext: CANONICAL_CAPTURE.sourceContext,
      todayIso: CANONICAL_TODAY,
      recentLabels: CANONICAL_CAPTURE.recentLabels,
      preferences: CANONICAL_CAPTURE.preferences,
    }),
    schema: asSchema(TriageOutput).jsonSchema,
    temperature: TRIAGE_TEMPERATURE,
  });

  const planCtx: PlanContext = {
    planDate: CANONICAL_TODAY,
    timeZone: "UTC",
    candidates: [
      toCandidate(task, "t1", CANONICAL_TODAY),
      toCandidate(
        {
          ...task,
          id: "task_fingerprint_2",
          title: CANONICAL_CAPTURE.openTasks[0]!.title,
          lifecycle: "active",
          due: CANONICAL_CAPTURE.openTasks[0]!.due,
          urgency: CANONICAL_CAPTURE.openTasks[0]!.urgency,
          importance: CANONICAL_CAPTURE.openTasks[0]!.importance,
          priorityBucket: "do_now",
          effort: CANONICAL_CAPTURE.openTasks[0]!.effort,
          editedFields: ["urgency"],
        },
        "t2",
        CANONICAL_TODAY,
      ),
    ],
    considered: 2,
    notShown: 0,
    recentCompletions: [
      { title: "Send the agenda", effort: "quick", completedAt: "2026-10-11T16:00:00.000Z" },
    ],
    preferences: CANONICAL_CAPTURE.preferences,
  };
  out[DAILY_PLAN_PROMPT_VERSION] = hash({
    system: dailyPlanSystem(planCtx),
    user: dailyPlanUser(planCtx),
    schema: asSchema(DailyPlanOutput).jsonSchema,
    temperature: DAILY_PLAN_TEMPERATURE,
  });

  out[MEMORY_PROMPT_VERSION] = hash({
    system: MEMORY_SYSTEM_PROMPT,
    user: buildMemoryUserPrompt({
      task,
      trigger: "edit",
      contradictions: [{ field: "urgency", aiValue: 0.8, userValue: 0.3 }],
      existing: CANONICAL_CAPTURE.preferences.map((text) => ({
        text,
        kind: "preference" as const,
      })),
      todayIso: CANONICAL_TODAY,
    }),
    schema: asSchema(MemoryExtractionOutput).jsonSchema,
    temperature: MEMORY_TEMPERATURE,
  });

  out[BRIEF_PROMPT_VERSION] = hash({
    system: BRIEF_SYSTEM_PROMPT,
    user: buildBriefUserPrompt({
      task,
      labelNames: CANONICAL_CAPTURE.recentLabels,
      preferences: CANONICAL_CAPTURE.preferences,
      todayIso: CANONICAL_TODAY,
    }),
    schema: asSchema(AgentBriefOutput).jsonSchema,
    temperature: BRIEF_TEMPERATURE,
  });

  return out;
}

export interface FingerprintFinding {
  version: string;
  kind: "changed-without-bump" | "unrecorded" | "bad-version";
  message: string;
}

export function compareFingerprints(
  current: Fingerprints,
  recorded: Fingerprints,
): FingerprintFinding[] {
  const findings: FingerprintFinding[] = [];
  for (const [version, hashNow] of Object.entries(current)) {
    if (!PROMPT_VERSION_RE.test(version)) {
      findings.push({
        version,
        kind: "bad-version",
        message: `prompt version "${version}" must look like "<stage>.v<n>"`,
      });
      continue;
    }
    const was = recorded[version];
    if (!was) {
      findings.push({
        version,
        kind: "unrecorded",
        message: `prompt version "${version}" has no recorded fingerprint. Run \`pnpm eval:update\` (offline) and commit evals/baselines/prompt-fingerprints.json with the prompt change.`,
      });
    } else if (was !== hashNow) {
      findings.push({
        version,
        kind: "changed-without-bump",
        message: `the prompt, schema, or temperature behind "${version}" changed but the version did not. Bump it (see lib/ai/prompts.ts), run \`pnpm eval:update\`, and commit the new fingerprint.`,
      });
    }
  }
  return findings;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
