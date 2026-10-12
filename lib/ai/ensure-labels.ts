import type { Repos } from "@/lib/db/repos";
import type { Label, LabelTone } from "@/lib/domain/types";
import { id as makeId } from "@/lib/utils/ids";

/** Same rotation the client uses so tones stay consistent across origins. */
const LABEL_TONE_PALETTE: LabelTone[] = ["neutral", "mist", "sand", "sage", "ember"];

/**
 * Resolve model-suggested label names to canonical labels, creating the
 * missing ones (idempotent by name, case-insensitive). Returns labels in
 * the order of `names` so callers can map positions back.
 */
export async function ensureLabelsByName(
  repos: Repos,
  userId: string,
  names: string[],
): Promise<Label[]> {
  const existing = await repos.labels.list(userId);
  const ensured: Label[] = [];
  let labelCount = existing.length;
  for (const name of names) {
    const match = existing.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (match) {
      ensured.push(match);
      continue;
    }
    const label = await repos.labels.ensure(userId, {
      id: makeId("label"),
      name,
      tone: LABEL_TONE_PALETTE[labelCount % LABEL_TONE_PALETTE.length]!,
    });
    labelCount += 1;
    existing.push(label);
    ensured.push(label);
  }
  return ensured;
}
