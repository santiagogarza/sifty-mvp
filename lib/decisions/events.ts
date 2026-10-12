/**
 * Fired on `window` when a watched sift settles — the moment a clarifying
 * question can have appeared. The Decisions inbox listens and refreshes;
 * a DOM event keeps the sift watcher free of a dependency on that store.
 */
export const SIFT_SETTLED_EVENT = "sifty:sift-settled";

export function announceSiftSettled(taskId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SIFT_SETTLED_EVENT, { detail: { taskId } }));
}
