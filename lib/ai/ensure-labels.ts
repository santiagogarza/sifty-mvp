import type { Repos } from "@/lib/db/repos";
import type { Label, LabelTone } from "@/lib/domain/types";
import { id as makeId } from "@/lib/utils/ids";

/** Same palette the client rotates through, so tones stay in one family. */
const LABEL_TONE_PALETTE: LabelTone[] = ["neutral", "mist", "sand", "sage", "ember"];

/**
 * Resolve model-suggested label names to canonical labels, creating the
 * missing ones (idempotent by name, case-insensitive). Returns labels in
 * the order of `names` so callers can map positions back.
 *
 * New labels take a tone derived from their name rather than from a count
 * of existing labels: no extra read, and the same name gets the same tone
 * on every device.
 */
export async function ensureLabelsByName(
  repos: Repos,
  userId: string,
  names: string[],
): Promise<Label[]> {
  if (!names.length) return [];
  const existing = await repos.labels.findByNames(userId, names);
  const ensured: Label[] = [];
  for (const name of names) {
    const match = existing.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (match) {
      ensured.push(match);
      continue;
    }
    const label = await repos.labels.ensure(userId, {
      id: makeId("label"),
      name,
      tone: toneForName(name),
    });
    existing.push(label);
    ensured.push(label);
  }
  return ensured;
}

export function toneForName(name: string): LabelTone {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return LABEL_TONE_PALETTE[hash % LABEL_TONE_PALETTE.length]!;
}
