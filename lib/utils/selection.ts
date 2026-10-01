/**
 * Contiguous range selection for list views (SIF-22).
 *
 * Given the ids of the currently visible rows in render order, returns the
 * inclusive range between the anchor (the last plain-clicked row) and the
 * shift-clicked target. Direction doesn't matter — clicking above the anchor
 * selects upward. If the anchor is missing or no longer visible, the range
 * collapses to just the target so a stale anchor can never select rows the
 * user didn't point at.
 */
export function rangeSelection(
  visibleIds: readonly string[],
  anchorId: string | null,
  targetId: string,
): string[] {
  const targetIndex = visibleIds.indexOf(targetId);
  if (targetIndex === -1) return [];
  const anchorIndex = anchorId === null ? -1 : visibleIds.indexOf(anchorId);
  if (anchorIndex === -1) return [targetId];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return visibleIds.slice(start, end + 1);
}
