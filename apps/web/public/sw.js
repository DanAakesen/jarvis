/* global self */

const itemIdPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const messages = {
  alert: {
    da: (count) => count === 1 ? '1 tidskritisk ting kræver din opmærksomhed' : `${count} tidskritiske ting kræver din opmærksomhed`,
    en: (count) => count === 1 ? '1 time-critical item needs you' : `${count} time-critical items need you`,
  },
  due_soon: {
    da: (count) => count === 1 ? 'En todo forfalder inden for en time' : `${count} todos forfalder inden for en time`,
    en: (count) => count === 1 ? 'A todo is due within the hour' : `${count} todos are due within the hour`,
  },
  overdue: {
    da: (count) => count === 1 ? 'En todo er forfalden' : `${count} todos er forfaldne`,
    en: (count) => count === 1 ? 'A todo is overdue' : `${count} todos are overdue`,
  },
  mixed: {
    da: (count) => `${count} todos kræver din opmærksomhed`,
    en: (count) => `${count} todos need your attention`,
  },
};
const validKinds = new Set(['alert', 'due_soon', 'overdue', 'mixed']);
const validLanguages = new Set(['da', 'en']);

function notificationBody(payload) {
  const { kind, lang, count } = payload ?? {};
  if (!validKinds.has(kind) || !validLanguages.has(lang) ||
      !Number.isInteger(count) || count < 1 || count > 99 ||
      (kind === 'mixed' && count < 2)) return 'New item';
  return messages[kind][lang](count);
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let itemId;
  let body = 'New item';
  try {
    const payload = event.data?.json();
    if (typeof payload?.itemId === 'string' && itemIdPattern.test(payload.itemId)) {
      itemId = payload.itemId;
    }
    body = notificationBody(payload);
  } catch {
    // Malformed push data still requires a visible notification on Safari.
  }

  event.waitUntil(self.registration.showNotification('Jarvis', {
    body,
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
