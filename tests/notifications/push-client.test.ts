// @vitest-environment jsdom
import {
  PushPermissionDeniedError,
  isIOS,
  isStandalone,
  pushSupport,
  subscribeToPush,
  urlBase64ToUint8Array,
} from "@/lib/notifications/push-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("urlBase64ToUint8Array", () => {
  it("decodes the URL-safe, unpadded VAPID public key format", () => {
    // "hello world" → base64url "aGVsbG8gd29ybGQ" (no padding).
    const bytes = urlBase64ToUint8Array("aGVsbG8gd29ybGQ");
    expect(new TextDecoder().decode(bytes)).toBe("hello world");
    expect(bytes.buffer).toBeInstanceOf(ArrayBuffer);
    // `-` and `_` map to `+` and `/`.
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });
});

describe("pushSupport", () => {
  const originalSW = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

  beforeEach(() => {
    // jsdom does not model secure contexts; the app only runs on https/localhost.
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalSW) Object.defineProperty(navigator, "serviceWorker", originalSW);
    else Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("reports what is missing instead of throwing", () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    expect(pushSupport()).toEqual({ ok: false, reason: "insecure" });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });

    // No service worker or PushManager in jsdom.
    expect(pushSupport()).toEqual({ ok: false, reason: "no_service_worker" });

    Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
    expect(pushSupport()).toEqual({ ok: false, reason: "no_push" });

    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", { permission: "default" });
    expect(pushSupport()).toEqual({ ok: true });
  });

  it("tells iPhone Safari tabs to install the app first", () => {
    Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {},
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1",
      maxTouchPoints: 5,
    });
    expect(isIOS()).toBe(true);
    expect(isStandalone()).toBe(false);
    expect(pushSupport()).toEqual({ ok: false, reason: "ios_not_installed" });
  });
});

describe("subscribeToPush", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("surfaces a denied permission as a readable error", async () => {
    const registration = { pushManager: { getSubscription: async () => null, subscribe: vi.fn() } };
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        register: async () => registration,
        ready: Promise.resolve(registration),
      },
    });
    vi.stubGlobal("Notification", { requestPermission: async () => "denied" });
    await expect(subscribeToPush("pub")).rejects.toBeInstanceOf(PushPermissionDeniedError);
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("times out a subscribe() that never settles", async () => {
    vi.useFakeTimers();
    try {
      const registration = {
        pushManager: { getSubscription: async () => null, subscribe: () => new Promise(() => {}) },
      };
      vi.stubGlobal("navigator", {
        ...navigator,
        serviceWorker: {
          register: async () => registration,
          ready: Promise.resolve(registration),
        },
      });
      vi.stubGlobal("Notification", { requestPermission: async () => "granted" });
      const pending = subscribeToPush("aGVsbG8");
      const assertion = expect(pending).rejects.toThrow(/push service/);
      await vi.advanceTimersByTimeAsync(20_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
