/* global self */

const itemIdPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let itemId;
  try {
    const payload = event.data?.json();
    if (typeof payload?.itemId === 'string' && itemIdPattern.test(payload.itemId)) {
      itemId = payload.itemId;
    }
  } catch {
    // Malformed push data still requires a visible notification on Safari.
  }

  event.waitUntil(self.registration.showNotification('Jarvis', {
    body: 'New item',
    tag: itemId ?? 'jarvis',
    data: itemId ? { itemId } : {},
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const itemId = event.notification.data?.itemId;
  const path = typeof itemId === 'string' && itemIdPattern.test(itemId)
    ? `/proactive/${itemId}`
    : '/';

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        const destination = await client.navigate(path);
        if (destination) {
          await destination.focus();
          return;
        }
      } catch {
        // A window that closed during navigation is no longer a usable target.
      }
    }
    await self.clients.openWindow(path);
  })());
});
