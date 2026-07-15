/* PTM Phase 3 notification service worker. Browser evidence only: validate,
 * dedupe, display, deep-link. It never acknowledges or resolves owner work. */
const DB_NAME = "ptm-notification-dedupe-v1";
const STORE = "dispatches";
const MAX_IDS = 500;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function validUuid(value) { return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value); }
function safeRoute(value) { return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && value.length <= 300; }
function validatePayload(value) {
  if (!value || value.schemaVersion !== 1 || !["owner_alert", "device_verification"].includes(value.messageType)) return null;
  if (!validUuid(value.dispatchId) || !safeRoute(value.route)) return null;
  if (typeof value.title !== "string" || value.title.length < 1 || value.title.length > 100) return null;
  if (typeof value.body !== "string" || value.body.length > 240) return null;
  return value;
}
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "dispatchId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function seenBefore(payload) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const get = store.get(payload.dispatchId);
    get.onerror = () => reject(get.error);
    get.onsuccess = () => {
      const now = Date.now(); const existing = get.result;
      store.put({ dispatchId: payload.dispatchId, firstSeenAt: existing?.firstSeenAt ?? now, lastSeenAt: now, schemaVersion: payload.schemaVersion });
      const all = store.getAll();
      all.onsuccess = () => {
        const rows = all.result.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
        rows.forEach((row, index) => { if (index >= MAX_IDS || row.lastSeenAt < now - MAX_AGE_MS) store.delete(row.dispatchId); });
      };
      tx.oncomplete = () => { db.close(); resolve(Boolean(existing)); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload; try { payload = validatePayload(event.data?.json()); } catch { return; }
    if (!payload) return;
    // Storage failure degrades to display: never silently lose a valid push.
    try { if (await seenBefore(payload)) return; } catch { /* display below */ }
    await self.registration.showNotification(payload.title, {
      body: payload.body, tag: payload.dispatchId, renotify: false,
      requireInteraction: payload.severity === "critical",
      data: { dispatchId: payload.dispatchId, alertId: payload.alertId ?? null, route: payload.route, schemaVersion: payload.schemaVersion },
    });
  })());
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data ?? {};
    if (!validUuid(data.dispatchId) || !safeRoute(data.route)) return;
    const url = new URL(data.route, self.location.origin);
    url.searchParams.set("notification", data.dispatchId);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url.href); return existing.focus(); }
    return self.clients.openWindow(url.href);
  })());
});
