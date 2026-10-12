/**
 * Range selection over a visible, ordered list (Shift+click semantics).
 * Pure so the list component stays thin and the edge cases are testable.
 */

/**
 * Ids from the anchor through the target, inclusive, in visible order. When
 * the anchor is missing (never clicked, or it left the view) the target
 * alone is selected.
 */
export function rangeBetween(
  visibleIds: readonly string[],
  anchorId: string | null,
  targetId: string,
): string[] {
  const targetIndex = visibleIds.indexOf(targetId);
  if (targetIndex === -1) return [];
  const anchorIndex = anchorId ? visibleIds.indexOf(anchorId) : -1;
  if (anchorIndex === -1) return [targetId];
  const [from, to] =
    anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  return visibleIds.slice(from, to + 1);
}

/** Drop selected ids that are no longer visible (moved, completed, deleted). */
export function pruneSelection(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): Set<string> {
  const visible = new Set(visibleIds);
  const next = new Set<string>();
  for (const id of selected) if (visible.has(id)) next.add(id);
  return next;
}
