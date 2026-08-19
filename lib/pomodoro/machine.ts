/**
 * Pomodoro state machine — pure, with the clock injected.
 *
 * Every interval is anchored to two absolute epoch timestamps read from the
 * server-synced clock (`lib/time/server-clock`), never to a tick counter.
 * Remaining time is always *derived* from `now`, so a throttled background
 * tab, a sleeping laptop, or a page reload cannot make the timer drift — the
 * next render recomputes it from UTC.
 *
 * The cycle is deliberately manual at the seams: a finished focus block waits
 * in `focus-done` until the person starts the break, and a finished break
 * waits in `break-done`. Auto-advancing would start counting rest while
 * someone is still mid-sentence.
 */

export const FOCUS_MS = 25 * 60_000;
export const BREAK_MS = 5 * 60_000;

/** A block this short with nothing completed is a misfire, not history. */
const MIN_LOGGED_MS = 60_000;
const HISTORY_LIMIT = 60;

export type PomodoroPhase = "idle" | "focus" | "focus-done" | "break" | "break-done";

export interface PomodoroCompletion {
  /** The task id, or the subtask id when `kind` is `"subtask"`. */
  id: string;
  kind: "task" | "subtask";
  title: string;
  at: number;
}

export interface PomodoroInterval {
  id: string;
  startedAt: number;
  /** Absolute end, pushed forward by however long the interval sat paused. */
  endsAt: number;
  pausedAt: number | null;
}

export interface PomodoroBlock extends PomodoroInterval {
  closedAt: number | null;
  completions: PomodoroCompletion[];
}

export interface PomodoroState {
  /** The open focus block. Null while idle or resting. */
  block: PomodoroBlock | null;
  /** The open break. Null unless resting. */
  rest: PomodoroInterval | null;
  /** Closed focus blocks, newest first. */
  history: PomodoroBlock[];
}

export function initialState(): PomodoroState {
  return { block: null, rest: null, history: [] };
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

export function activeInterval(state: PomodoroState): PomodoroInterval | null {
  return state.block ?? state.rest ?? null;
}

export function isPaused(state: PomodoroState): boolean {
  const interval = activeInterval(state);
  return interval !== null && interval.pausedAt !== null;
}

export function phase(state: PomodoroState, now: number): PomodoroPhase {
  if (state.block) {
    return state.block.pausedAt !== null || now < state.block.endsAt ? "focus" : "focus-done";
  }
  if (state.rest) {
    return state.rest.pausedAt !== null || now < state.rest.endsAt ? "break" : "break-done";
  }
  return "idle";
}

export function remainingMs(state: PomodoroState, now: number): number {
  const interval = activeInterval(state);
  if (!interval) return 0;
  return Math.max(0, interval.endsAt - (interval.pausedAt ?? now));
}

/** Full length of whatever is running, for progress rings. */
export function intervalMs(state: PomodoroState): number {
  if (state.block) return FOCUS_MS;
  if (state.rest) return BREAK_MS;
  return 0;
}

/** 0 at the start of the running interval, 1 once it has elapsed. */
export function elapsedFraction(state: PomodoroState, now: number): number {
  const total = intervalMs(state);
  if (!total) return 0;
  return Math.min(1, Math.max(0, 1 - remainingMs(state, now) / total));
}

/**
 * Time actually spent focusing in a block, excluding paused stretches and
 * capped at one pomodoro — working past the bell doesn't earn a longer block.
 */
export function focusedMs(block: PomodoroBlock, now = block.startedAt): number {
  const at = block.closedAt ?? now;
  const reference = block.pausedAt ?? at;
  return Math.min(FOCUS_MS, Math.max(0, FOCUS_MS - Math.max(0, block.endsAt - reference)));
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

function closeBlock(state: PomodoroState, now: number): PomodoroBlock[] {
  const block = state.block;
  if (!block) return state.history;
  const worthKeeping =
    block.completions.length > 0 || focusedMs({ ...block, closedAt: now }) >= MIN_LOGGED_MS;
  if (!worthKeeping) return state.history;
  return [{ ...block, closedAt: now }, ...state.history].slice(0, HISTORY_LIMIT);
}

export function startFocus(state: PomodoroState, now: number, id: string): PomodoroState {
  return {
    block: {
      id,
      startedAt: now,
      endsAt: now + FOCUS_MS,
      pausedAt: null,
      closedAt: null,
      completions: [],
    },
    rest: null,
    history: closeBlock(state, now),
  };
}

export function startBreak(state: PomodoroState, now: number, id: string): PomodoroState {
  return {
    block: null,
    rest: { id, startedAt: now, endsAt: now + BREAK_MS, pausedAt: null },
    history: closeBlock(state, now),
  };
}

/** Back to idle: the focus block is logged, an unfinished break is discarded. */
export function stop(state: PomodoroState, now: number): PomodoroState {
  return { block: null, rest: null, history: closeBlock(state, now) };
}

export function togglePause(state: PomodoroState, now: number): PomodoroState {
  const interval = activeInterval(state);
  // Nothing to hold: the interval already rang and is waiting on a decision.
  if (!interval || remainingMs(state, now) === 0) return state;

  const next =
    interval.pausedAt === null
      ? { ...interval, pausedAt: now }
      : { ...interval, pausedAt: null, endsAt: interval.endsAt + (now - interval.pausedAt) };

  return state.block ? { ...state, block: { ...state.block, ...next } } : { ...state, rest: next };
}

/** Completions land on the open focus block only; history is immutable. */
export function recordCompletion(
  state: PomodoroState,
  completion: PomodoroCompletion,
): PomodoroState {
  const block = state.block;
  if (!block) return state;
  if (block.completions.some((c) => c.id === completion.id)) return state;
  return { ...state, block: { ...block, completions: [...block.completions, completion] } };
}

/** Un-checking inside the same block retracts the credit, so counts stay true. */
export function undoCompletion(state: PomodoroState, id: string): PomodoroState {
  const block = state.block;
  if (!block?.completions.some((c) => c.id === id)) return state;
  return {
    ...state,
    block: { ...block, completions: block.completions.filter((c) => c.id !== id) },
  };
}
