"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { notify, playChime, primeAlerts, requestNotifications } from "@/lib/pomodoro/alerts";
import {
  BREAK_MS,
  FOCUS_MS,
  type PomodoroBlock,
  type PomodoroPhase,
  elapsedFraction,
  focusedMs,
  formatCountdown,
  isPaused,
  phase as phaseOf,
  remainingMs,
} from "@/lib/pomodoro/machine";
import { usePomodoro } from "@/lib/pomodoro/store";
import { isClockSynced, serverNow, syncServerClock } from "@/lib/time/server-clock";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay } from "@/lib/utils/dates";
import {
  Bell,
  BellOff,
  ChevronDown,
  Coffee,
  Pause,
  Play,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import * as React from "react";

/**
 * The focus timer's one piece of chrome: 25 minutes of work, 5 of rest.
 *
 * It stays roughly one icon wide because the point of the feature is to
 * disappear once it's running. The exact countdown, what got closed, and past
 * blocks all live one click away in the panel.
 *
 * At the seams — a block ending — it gets briefly loud on purpose. That's the
 * moment the timer exists to tell you about.
 */

const RESYNC_INTERVAL_MS = 5 * 60_000;

const EYEBROW: Record<PomodoroPhase, string> = {
  idle: "Focus timer",
  focus: "Focusing",
  "focus-done": "Break time",
  break: "On a break",
  "break-done": "Back to it",
};

export function PomodoroControl() {
  const timer = usePomodoro((s) => s.timer);
  const soundEnabled = usePomodoro((s) => s.soundEnabled);
  const notifyEnabled = usePomodoro((s) => s.notifyEnabled);
  const [open, setOpen] = React.useState(false);

  // Null until the first client effect: the persisted timer must not
  // influence server-rendered markup.
  const [now, setNow] = React.useState<number | null>(null);
  const mounted = now !== null;
  const running = mounted && (timer.block !== null || timer.rest !== null);

  React.useEffect(() => {
    setNow(serverNow());
    void syncServerClock().then(() => setNow(serverNow()));
  }, []);

  React.useEffect(() => {
    if (!running) return;
    const tick = () => setNow(serverNow());
    const resync = () => {
      void syncServerClock().then(tick);
    };
    const onVisibility = () => {
      // Background tabs get throttled to about one tick a minute. Catch up
      // the moment we're looked at again, and re-check the clock in case the
      // machine slept through half the block.
      if (document.visibilityState === "visible") resync();
    };

    const ticker = window.setInterval(tick, 1000);
    const resyncer = window.setInterval(resync, RESYNC_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(ticker);
      window.clearInterval(resyncer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", tick);
    };
  }, [running]);

  const phase = mounted ? phaseOf(timer, now) : "idle";
  const paused = mounted && isPaused(timer);
  const remaining = mounted ? remainingMs(timer, now) : FOCUS_MS;
  const fraction = mounted ? elapsedFraction(timer, now) : 0;
  const closedThisBlock = timer.block?.completions.length ?? 0;

  // Announce a phase change, but never on the first observation — opening the
  // tab onto an already-elapsed block shouldn't chime.
  const lastPhase = React.useRef<PomodoroPhase | null>(null);
  React.useEffect(() => {
    if (!mounted) return;
    const previous = lastPhase.current;
    lastPhase.current = phase;
    if (previous === null || previous === phase) return;
    if (phase !== "focus-done" && phase !== "break-done") return;

    const breakTime = phase === "focus-done";
    if (soundEnabled) playChime(breakTime ? "break" : "focus");
    if (notifyEnabled) {
      notify(
        breakTime ? "Time for a break" : "Break's over",
        breakTime
          ? `25 minutes done${closedThisBlock ? `, ${closedThisBlock} closed` : ""}. Take five.`
          : "Start the next 25-minute block.",
      );
    }
    if (document.visibilityState === "visible") setOpen(true);
  }, [mounted, phase, soundEnabled, notifyEnabled, closedThisBlock]);

  // The tab title is the one signal that survives a buried window.
  React.useEffect(() => {
    if (phase !== "focus-done" && phase !== "break-done") return;
    const original = document.title;
    document.title = `${phase === "focus-done" ? "Break time" : "Focus time"} · ${original}`;
    return () => {
      document.title = original;
    };
  }, [phase]);

  const start = React.useCallback(async (kind: "focus" | "break") => {
    // Audio only unlocks inside a gesture, and the chime is 25 minutes out.
    primeAlerts();
    // Anchors must be written in the server clock's domain. Before the first
    // sample lands they'd be local time and would jump once the offset is
    // adopted, so wait out the (shared, timeout-bounded) sync first. A failed
    // sync still falls back to the local clock.
    if (!isClockSynced()) await syncServerClock();
    const store = usePomodoro.getState();
    if (kind === "focus") store.startFocus();
    else store.startBreak();
    setNow(serverNow());
  }, []);

  /**
   * One click, one meaning: start what's next, or — while a block is already
   * running — show the details. Pausing lives in the panel so a stray click
   * on the header can never stop the clock.
   */
  const onPrimary = React.useCallback(() => {
    if (phase === "idle" || phase === "break-done") void start("focus");
    else if (phase === "focus-done") void start("break");
    else setOpen((v) => !v);
  }, [phase, start]);

  const tone: "work" | "rest" = phase === "break" || phase === "focus-done" ? "rest" : "work";
  const toneColor = tone === "rest" ? "var(--done)" : "var(--accent)";
  const awaiting = phase === "focus-done" || phase === "break-done";
  const hint = triggerHint(phase, paused, remaining);

  return (
    <TooltipProvider>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div
            className={cn(
              "flex h-9 items-center rounded-[var(--radius-md)] border transition-colors",
              running || awaiting
                ? "border-[var(--border-strong)] bg-[var(--surface)]"
                : "border-transparent",
            )}
          >
            <Tooltip label={hint}>
              <button
                type="button"
                onClick={onPrimary}
                aria-label={hint}
                className={cn(
                  "flex h-9 items-center gap-1.5 rounded-l-[var(--radius-md)] pl-2.5 pr-1.5",
                  "text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg)]",
                )}
              >
                {phase === "idle" ? (
                  <Play size={13} strokeWidth={2.2} fill="currentColor" />
                ) : awaiting ? (
                  <span
                    className="animate-pulse-soft size-[7px] shrink-0 rounded-full"
                    style={{ background: toneColor }}
                  />
                ) : (
                  <Dial fraction={fraction} color={toneColor} dimmed={paused} />
                )}
                {phase === "idle" ? null : (
                  <span
                    // Fixed width: the countdown and the "Break"/"Focus"
                    // labels must not shuffle the rest of the header around.
                    className={cn(
                      "text-num w-[38px] text-left text-[12px] font-medium",
                      paused && "opacity-50",
                    )}
                    style={awaiting ? { color: toneColor } : undefined}
                  >
                    {awaiting
                      ? phase === "focus-done"
                        ? "Break"
                        : "Focus"
                      : formatCountdown(remaining)}
                  </span>
                )}
              </button>
            </Tooltip>

            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Focus timer details"
                className="flex h-9 w-5 items-center justify-center rounded-r-[var(--radius-md)] text-[var(--fg-subtle)] opacity-70 transition-opacity hover:opacity-100"
              >
                <ChevronDown size={11} strokeWidth={2.4} />
              </button>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="end"
          className="w-[302px] p-0"
          // The panel can open on its own when a block ends; it must never
          // pull focus out of whatever the person was typing.
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <Panel
            phase={phase}
            paused={paused}
            remaining={remaining}
            now={now ?? Date.now()}
            onStartFocus={() => void start("focus")}
            onStartBreak={() => void start("break")}
          />
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}

function triggerHint(phase: PomodoroPhase, paused: boolean, remaining: number): string {
  if (phase === "idle") return "Start a 25-minute focus block";
  if (phase === "focus-done") return "Focus block done — start your 5-minute break";
  if (phase === "break-done") return "Break's over — start the next focus block";
  const what = phase === "focus" ? "focus" : "break";
  if (paused) return `Paused with ${formatCountdown(remaining)} of ${what} left`;
  return `${formatCountdown(remaining)} of ${what} left`;
}

/** A 15px countdown ring — readable at a glance without reading digits. */
function Dial({
  fraction,
  color,
  dimmed,
}: {
  fraction: number;
  color: string;
  dimmed: boolean;
}) {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn("shrink-0", dimmed && "opacity-45")}
    >
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="var(--border-strong)"
        strokeWidth="1.75"
      />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function Panel({
  phase,
  paused,
  remaining,
  now,
  onStartFocus,
  onStartBreak,
}: {
  phase: PomodoroPhase;
  paused: boolean;
  remaining: number;
  now: number;
  onStartFocus: () => void;
  onStartBreak: () => void;
}) {
  const timer = usePomodoro((s) => s.timer);
  const soundEnabled = usePomodoro((s) => s.soundEnabled);
  const notifyEnabled = usePomodoro((s) => s.notifyEnabled);
  const setSoundEnabled = usePomodoro((s) => s.setSoundEnabled);
  const setNotifyEnabled = usePomodoro((s) => s.setNotifyEnabled);
  const togglePause = usePomodoro((s) => s.togglePause);
  const stop = usePomodoro((s) => s.stop);
  const clearHistory = usePomodoro((s) => s.clearHistory);

  const holdable = phase === "focus" || phase === "break";
  // Between blocks the clock previews what the button underneath will start.
  const display =
    phase === "focus-done"
      ? BREAK_MS
      : phase === "focus" || phase === "break"
        ? remaining
        : FOCUS_MS;

  return (
    <div className="text-[var(--fg)]">
      <div className="px-3 pb-3 pt-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-eyebrow">{EYEBROW[phase]}</div>
            <div className="text-display text-num mt-0.5 text-[32px] leading-none">
              {formatCountdown(display)}
            </div>
          </div>
          {holdable ? (
            <div className="flex items-center gap-0.5">
              <IconAction label={paused ? "Resume" : "Pause"} onClick={togglePause}>
                {paused ? (
                  <Play size={12} strokeWidth={2.2} fill="currentColor" />
                ) : (
                  <Pause size={12} strokeWidth={2.2} fill="currentColor" />
                )}
              </IconAction>
              <IconAction label="Stop" onClick={stop}>
                <Square size={11} strokeWidth={2.2} fill="currentColor" />
              </IconAction>
            </div>
          ) : null}
        </div>

        {phase === "idle" || phase === "break-done" ? (
          <Button variant="primary" className="mt-2.5 w-full" onClick={onStartFocus}>
            <Play size={13} strokeWidth={2.2} fill="currentColor" />
            {phase === "idle" ? "Start focus block" : "Start next focus block"}
          </Button>
        ) : null}
        {phase === "focus-done" ? (
          <Button variant="primary" className="mt-2.5 w-full" onClick={onStartBreak}>
            <Coffee size={14} strokeWidth={2.2} />
            Start 5-minute break
          </Button>
        ) : null}
      </div>

      {timer.block ? (
        <section className="border-t border-[var(--border)] px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-eyebrow">Closed this block</span>
            <span className="text-num text-[12px] text-[var(--fg-muted)]">
              {timer.block.completions.length}
            </span>
          </div>
          {timer.block.completions.length === 0 ? (
            <p className="mt-1 text-[12.5px] leading-snug text-[var(--fg-subtle)]">
              Nothing yet. Pick one thing and finish it before the bell.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {timer.block.completions.map((completion) => (
                <CompletionRow
                  key={completion.id}
                  title={completion.title}
                  kind={completion.kind}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <History history={timer.history} now={now} />

      <div className="flex items-center justify-between gap-1 border-t border-[var(--border)] px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          <Toggle
            active={soundEnabled}
            label="Chime"
            onClick={() => setSoundEnabled(!soundEnabled)}
          >
            {soundEnabled ? <Volume2 size={11.5} /> : <VolumeX size={11.5} />}
          </Toggle>
          <Toggle
            active={notifyEnabled}
            label="Notify"
            onClick={async () => {
              if (notifyEnabled) {
                setNotifyEnabled(false);
                return;
              }
              setNotifyEnabled(await requestNotifications());
            }}
          >
            {notifyEnabled ? <Bell size={11.5} /> : <BellOff size={11.5} />}
          </Toggle>
        </div>
        {timer.history.length > 0 ? (
          <button
            type="button"
            className="px-1.5 text-[11.5px] text-[var(--fg-subtle)] transition-colors hover:text-[var(--warn)]"
            onClick={() => {
              if (confirm("Clear your focus history? This browser only.")) clearHistory();
            }}
          >
            Clear history
          </button>
        ) : null}
      </div>
    </div>
  );
}

function History({ history, now }: { history: PomodoroBlock[]; now: number }) {
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const today = history.filter((block) => sameDay(block.startedAt, now));
  const todayClosed = today.reduce((sum, block) => sum + block.completions.length, 0);

  return (
    <section className="border-t border-[var(--border)]">
      <div className="flex items-baseline justify-between gap-2 px-3 pb-1 pt-2.5">
        <span className="text-eyebrow">History</span>
        {today.length > 0 ? (
          <span className="text-num text-[11.5px] text-[var(--fg-subtle)]">
            Today · {today.length} {today.length === 1 ? "block" : "blocks"} · {todayClosed} closed
          </span>
        ) : null}
      </div>

      {history.length === 0 ? (
        <p className="px-3 pb-3 text-[12.5px] leading-snug text-[var(--fg-subtle)]">
          Finished blocks collect here, with what you closed in each one.
        </p>
      ) : (
        <ul className="max-h-[236px] overflow-y-auto pb-1">
          {history.map((block, index) => {
            const previous = history[index - 1];
            const startsDay = !previous || !sameDay(previous.startedAt, block.startedAt);
            const isOpen = expanded === block.id;
            const count = block.completions.length;
            return (
              <li key={block.id}>
                {startsDay ? (
                  <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-[var(--fg-subtle)]">
                    {formatRelativeDay(new Date(block.startedAt), new Date(now))}
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={count === 0}
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : block.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1 text-left",
                    count > 0 && "hover:bg-[var(--surface-hover)]",
                  )}
                >
                  {/* Min-width, not fixed: a 12-hour locale adds "AM". */}
                  <span className="text-num min-w-[46px] shrink-0 whitespace-nowrap text-[12px] text-[var(--fg-muted)]">
                    {clockTime(block.startedAt)}
                  </span>
                  <span className="text-num w-[28px] shrink-0 text-[12px] text-[var(--fg-subtle)]">
                    {Math.round(focusedMs(block) / 60_000)}m
                  </span>
                  <span
                    className={cn(
                      "flex-1 truncate text-[12.5px]",
                      count > 0 ? "text-[var(--fg)]" : "text-[var(--fg-subtle)]",
                    )}
                  >
                    {count > 0 ? `${count} closed` : "nothing closed"}
                  </span>
                  {count > 0 ? (
                    <ChevronDown
                      size={11}
                      className={cn(
                        "shrink-0 text-[var(--fg-subtle)] transition-transform",
                        isOpen && "rotate-180",
                      )}
                    />
                  ) : null}
                </button>
                {isOpen ? (
                  <ul className="space-y-1 pb-2 pl-[70px] pr-3 pt-0.5">
                    {block.completions.map((completion) => (
                      <CompletionRow
                        key={completion.id}
                        title={completion.title}
                        kind={completion.kind}
                      />
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CompletionRow({ title, kind }: { title: string; kind: "task" | "subtask" }) {
  return (
    <li className="flex items-start gap-1.5 text-[12.5px] leading-snug">
      <span
        aria-hidden="true"
        className={cn(
          "mt-[6px] size-1 shrink-0 rounded-full",
          kind === "subtask" ? "bg-[var(--fg-subtle)]" : "bg-[var(--done)]",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-[var(--fg-muted)]">{title}</span>
    </li>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button variant="ghost" size="iconSm" aria-label={label} title={label} onClick={onClick}>
      {children}
    </Button>
  );
}

function Toggle({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11.5px]",
        "transition-colors hover:bg-[var(--surface-hover)]",
        active ? "text-[var(--fg)]" : "text-[var(--fg-subtle)]",
      )}
    >
      {children}
      {label}
    </button>
  );
}

function sameDay(a: number, b: number): boolean {
  const left = new Date(a);
  const right = new Date(b);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
