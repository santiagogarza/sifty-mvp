/**
 * A one-way notification that something got checked off.
 *
 * The task store owns completion; the focus timer wants to count it. Rather
 * than have the store know about pomodoros (or the timer diff the whole task
 * list on every keystroke), the store announces the transition and anyone
 * interested listens. Same shape as the sync hooks, one level lighter.
 */

export interface CompletionEvent {
  /** The task id, or the subtask id when `kind` is `"subtask"`. */
  id: string;
  kind: "task" | "subtask";
  taskId: string;
  title: string;
  /** False when the box was *un*-checked, so listeners can retract credit. */
  done: boolean;
}

type CompletionListener = (event: CompletionEvent) => void;

const listeners = new Set<CompletionListener>();

export function onCompletion(listener: CompletionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A listener that throws must never break the mutation that triggered it. */
export function emitCompletion(event: CompletionEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.warn("[sifty] completion listener failed:", err);
    }
  }
}
