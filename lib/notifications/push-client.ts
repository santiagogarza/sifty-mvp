/**
 * Browser side of Web Push. Imported only from client components.
 *
 * iOS note: Safari delivers push to web apps only when they are installed
 * on the Home Screen (iOS 16.4+), and `Notification` does not exist in a
 * Safari tab. `pushSupport()` tells the Settings UI which hint to show.
 */

export const SERVICE_WORKER_URL = "/sw.js";

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: "insecure" | "no_service_worker" | "no_push" | "ios_not_installed" };

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return { ok: false, reason: "no_service_worker" };
  if (!window.isSecureContext) return { ok: false, reason: "insecure" };
  if (!("serviceWorker" in navigator)) return { ok: false, reason: "no_service_worker" };
  if (!("PushManager" in window) || !("Notification" in window)) {
    return { ok: false, reason: isIOS() && !isStandalone() ? "ios_not_installed" : "no_push" };
  }
  return { ok: true };
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; the touch-points check tells them apart.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
  await navigator.serviceWorker.ready;
  return registration;
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupport().ok) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export class PushPermissionDeniedError extends Error {
  constructor() {
    super("Notifications are blocked for this site. Allow them in the browser settings.");
    this.name = "PushPermissionDeniedError";
  }
}

/** Ask for permission (if needed) and subscribe this browser. */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription> {
  const registration = await registerServiceWorker();
  if (!registration) throw new Error("Service workers are not available in this browser.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushPermissionDeniedError();
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
}

/** Drop this browser's subscription; returns the endpoint that was removed. */
export async function unsubscribeFromPush(): Promise<string | null> {
  const subscription = await getCurrentSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
