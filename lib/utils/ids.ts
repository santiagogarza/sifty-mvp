/**
 * Cheap, sortable-ish IDs without an extra dep. The 8-char base36 random tail
 * is more than enough collision protection for a single-user app, and the
 * leading timestamp makes IDs roughly time-ordered which keeps logs scannable.
 */
export function id(prefix = "id"): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}${rand}`;
}
