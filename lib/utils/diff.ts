/**
 * Line diff for the edit-then-approve view: what the user changed in a
 * draft, as a list of kept / added / removed lines. Classic LCS over the
 * lines; drafts are short (a few hundred lines at most), so the O(n·m)
 * table is fine and the output is exact rather than heuristic.
 */

export type DiffOp = "equal" | "add" | "remove";

export interface DiffLine {
  op: DiffOp;
  text: string;
}

/** Hard cap on lines compared, so a pasted novel cannot hang the inbox. */
const MAX_LINES = 2000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map((text) => ({ op: "remove" as const, text })),
      ...b.map((text) => ({ op: "add" as const, text })),
    ];
  }
  // lcs[i][j] = length of the LCS of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: "equal", text: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ op: "remove", text: a[i]! });
      i += 1;
    } else {
      out.push({ op: "add", text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) out.push({ op: "remove", text: a[i++]! });
  while (j < b.length) out.push({ op: "add", text: b[j++]! });
  return out;
}

/** Added and removed line counts, for a "+3 −1" summary. */
export function diffStats(lines: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.op === "add") added += 1;
    else if (line.op === "remove") removed += 1;
  }
  return { added, removed };
}

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (normalized === "") return [];
  return normalized.split("\n");
}
