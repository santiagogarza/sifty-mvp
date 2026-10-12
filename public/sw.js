/*
 * Sifty service worker.
 *
 * Push only: shows the notification the server sent and opens (or focuses)
 * the app on click. No fetch interception and no caching, so Next.js
 * assets and API calls behave exactly as without a worker.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "Sifty", body: "", url: "/today", tag: undefined };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    payload.body = event.data ? event.data.text() : "";
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Sifty", {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag,
      renotify: Boolean(payload.tag),
      data: { url: payload.url || "/today" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/today", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find(
        (c) => "focus" in c && new URL(c.url).origin === self.location.origin,
      );
      if (existing) {
        return existing.focus().then((c) => (c && "navigate" in c ? c.navigate(target) : c));
      }
      return self.clients.openWindow(target);
    }),
  );
});

/* A browser may rotate the subscription; re-register it so the server never pushes to a dead endpoint. */
self.addEventListener("pushsubscriptionchange", (event) => {
  const resubscribe = self.registration.pushManager
    .subscribe(event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true })
    .then((subscription) =>
      fetch("/api/notifications/push/subscribe", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      }),
    )
    .catch(() => undefined);
  event.waitUntil(resubscribe);
});
