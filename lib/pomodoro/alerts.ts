"use client";

/**
 * How the timer says "stop" and "go" when you aren't looking at the header.
 *
 * Two channels, both opt-out-able and neither of which requires a permission
 * prompt up front: a short synthesized chime and — only if explicitly turned
 * on — a system notification.
 */

let audioContext: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!audioContext) audioContext = new Ctor();
  } catch {
    // No output device (headless, locked-down kiosk): stay silent.
    return null;
  }
  return audioContext;
}

/**
 * Autoplay policy only unlocks audio inside a user gesture, and the chime
 * fires 25 minutes later. Call this from the click that starts the timer.
 */
export function primeAlerts(): void {
  void ensureContext()
    ?.resume()
    .catch(() => undefined);
}

/** Rising for "you're free", settling for "back in". */
const MOTIFS: Record<"focus" | "break", number[]> = {
  break: [659.25, 880],
  focus: [880, 587.33],
};

export function playChime(kind: "focus" | "break"): void {
  const ctx = ensureContext();
  if (!ctx) return;
  void ctx.resume().catch(() => undefined);

  const base = ctx.currentTime;
  MOTIFS[kind].forEach((frequency, index) => {
    const start = base + index * 0.18;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    // Exponential ramps can't touch zero, hence the near-silent floor.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.1, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.55);
  });
}

export function notificationsAvailable(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationsGranted(): boolean {
  return notificationsAvailable() && Notification.permission === "granted";
}

export async function requestNotifications(): Promise<boolean> {
  if (!notificationsAvailable()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

export function notify(title: string, body: string): void {
  if (!notificationsGranted()) return;
  try {
    // One tag, so a missed pomodoro doesn't stack up a wall of banners.
    new Notification(title, { body, tag: "sifty-pomodoro" });
  } catch {
    // Some browsers reject constructed notifications outside a service
    // worker; the chime and the header pill still carry the message.
  }
}
