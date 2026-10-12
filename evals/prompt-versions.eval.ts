import { STAGE_DEFINITIONS } from "@/lib/ai/sift/stages";
import { SIFT_STAGES } from "@/lib/domain/types";
import { describe, expect, it } from "vitest";
import { readFingerprints, writeFingerprints } from "./harness/baselines";
import {
  PROMPT_VERSION_RE,
  compareFingerprints,
  computeFingerprints,
} from "./harness/fingerprints";

/**
 * Enforces the prompt version bump policy (`lib/ai/prompts.ts`): a prompt,
 * schema, or temperature change must come with a new `promptVersion`, and
 * every version in the code must have a recorded fingerprint, which only
 * `pnpm eval:update` writes — so a bump is always accompanied by an eval run.
 *
 * Runs in every mode and needs no model.
 */

const update = process.env.EVAL_UPDATE_BASELINES === "1";
const current = computeFingerprints();
const recorded = readFingerprints();

if (update) {
  // Keep historical versions: `ai_runs.prompt_version` rows still reference them.
  writeFingerprints({ ...recorded, ...current });
}

describe("prompt versions", () => {
  it.each(Object.keys(current))("%s is well-formed", (version) => {
    expect(version).toMatch(PROMPT_VERSION_RE);
  });

  it("stage prompt versions are distinct", () => {
    const versions = SIFT_STAGES.map((s) => STAGE_DEFINITIONS[s].promptVersion);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it.each(Object.keys(current))("%s matches its recorded fingerprint", (version) => {
    if (update) return;
    const findings = compareFingerprints({ [version]: current[version]! }, recorded);
    expect(
      findings.map((f) => f.message),
      findings.map((f) => f.message).join("\n"),
    ).toEqual([]);
  });
});
