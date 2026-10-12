"use client";

import { registerServiceWorker } from "@/lib/notifications/push-client";
import * as React from "react";

/**
 * Keeps `/sw.js` registered for signed-in users so an updated worker is
 * picked up on the next visit and `pushsubscriptionchange` has a handler.
 * Registration alone never prompts for anything; permission is only asked
 * for from Settings → Notifications.
 */
export function ServiceWorkerRegistrar() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    registerServiceWorker().catch(() => undefined);
  }, []);
  return null;
}
