import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const workerSource = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
const itemId = '11111111-1111-4111-8111-111111111111';

interface WorkerEvent {
  data?: { json: () => unknown } | null;
  notification?: { close: () => void; data?: unknown };
  waitUntil: (promise: Promise<unknown>) => void;
}

type WorkerHandler = (event: WorkerEvent) => void;

function createWorker(clients: Record<string, unknown> = {}) {
  const handlers = new Map<string, WorkerHandler>();
  const pending: Promise<unknown>[] = [];
  const showNotification = vi.fn<ServiceWorkerRegistration['showNotification']>(async () => {});
  const scope = {
    addEventListener: (name: string, handler: WorkerHandler) => handlers.set(name, handler),
    registration: { showNotification },
    skipWaiting: vi.fn(async () => {}),
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => {}),
      ...clients,
    },
  };
  runInNewContext(workerSource, { self: scope });
  const dispatch = (name: string, event: Omit<WorkerEvent, 'waitUntil'> = {}) => {
    handlers.get(name)?.({
      ...event,
      waitUntil: (promise) => { pending.push(promise); },
    });
  };
  const settle = async () => { await Promise.all(pending.splice(0)); };
  return { scope, showNotification, dispatch, settle };
}

describe('push service worker', () => {
  it('shows a generic notification for payloads without valid templates and malformed data', async () => {
    const { showNotification, dispatch, settle } = createWorker();
    dispatch('push', { data: { json: () => ({ itemId, title: 'Private title', body: 'Private body' }) } });
    dispatch('push', { data: { json: () => ({ itemId: 'https://example.invalid/path', kind: 'unknown', lang: 'en', count: 1 }) } });
    dispatch('push', { data: { json: () => { throw new SyntaxError('bad JSON'); } } });
    dispatch('push');
    await settle();

    expect(showNotification).toHaveBeenCalledTimes(4);
    expect(showNotification).toHaveBeenNthCalledWith(1, 'New item', {
      body: '', tag: itemId, data: { itemId },
    });
    for (const call of showNotification.mock.calls.slice(1)) {
      expect(call[0]).toBe('New item');
      expect(call[1]).toMatchObject({ body: '', tag: 'jarvis', data: {} });
    }
  });

  it.each([
    ['alert', 'da', 1, '1 tidskritisk ting kræver din opmærksomhed'],
    ['alert', 'da', 2, '2 tidskritiske ting kræver din opmærksomhed'],
    ['alert', 'en', 1, '1 time-critical item needs you'],
    ['alert', 'en', 2, '2 time-critical items need you'],
    ['due_soon', 'da', 1, 'En todo forfalder inden for en time'],
    ['due_soon', 'da', 2, '2 todos forfalder inden for en time'],
    ['due_soon', 'en', 1, 'A todo is due within the hour'],
    ['due_soon', 'en', 2, '2 todos are due within the hour'],
    ['overdue', 'da', 1, 'En todo er forfalden'],
    ['overdue', 'da', 2, '2 todos er forfaldne'],
    ['overdue', 'en', 1, 'A todo is overdue'],
    ['overdue', 'en', 2, '2 todos are overdue'],
    ['mixed', 'da', 2, '2 todos kræver din opmærksomhed'],
    ['mixed', 'en', 2, '2 todos need your attention'],
  ] as const)('uses a fixed %s/%s title for count %i', async (kind, lang, count, title) => {
    const { showNotification, dispatch, settle } = createWorker();
    dispatch('push', { data: { json: () => ({ v: 1, itemId, kind, lang, count, body: 'Synthetic secret text' }) } });
    await settle();
    expect(showNotification).toHaveBeenCalledWith(title, {
      body: '', tag: itemId, data: { itemId },
    });
    expect(JSON.stringify(showNotification.mock.calls)).not.toContain('Synthetic secret text');
  });

  it.each([0, 100, 1.5, '2', Number.NaN, undefined])('uses generic text for invalid count %s', async (count) => {
    const { showNotification, dispatch, settle } = createWorker();
    dispatch('push', { data: { json: () => ({ itemId, kind: 'alert', lang: 'en', ...(count === undefined ? {} : { count }) }) } });
    await settle();
    expect(showNotification).toHaveBeenCalledWith('New item', { body: '', tag: itemId, data: { itemId } });
  });

  it.each([
    { kind: 'unknown', lang: 'en', count: 1 },
    { kind: 'alert', lang: 'unknown', count: 1 },
    { kind: 'mixed', lang: 'en', count: 1 },
  ])('uses generic text for invalid template input %#', async (invalid) => {
    const { showNotification, dispatch, settle } = createWorker();
    dispatch('push', { data: { json: () => ({ itemId, ...invalid }) } });
    await settle();
    expect(showNotification).toHaveBeenCalledWith('New item', { body: '', tag: itemId, data: { itemId } });
  });

  it.each([
    ['En todo er forfalden', 'Send regningen\nRing til tandlægen\nBestil tid\n+2 mere'],
    ['A todo is overdue', 'Send the invoice\nCall the dentist\nBook a visit\n+2 more'],
    ['Test notification', 'Push notifications are working on this device.'],
  ])('uses server-composed v2 text without legacy metadata: %s', async (title, body) => {
    const { showNotification, dispatch, settle } = createWorker();
    dispatch('push', { data: { json: () => ({ v: 2, itemId, title, body }) } });
    await settle();
    expect(showNotification).toHaveBeenCalledWith(title, { body, tag: itemId, data: { itemId } });
  });

  it('prefers v2 text to compatibility metadata and accepts an empty body', async () => {
    const { showNotification, dispatch, settle } = createWorker();
    dispatch('push', { data: { json: () => ({
      v: 2, title: 'Meeting in ten minutes', body: '', kind: 'alert', lang: 'en', count: 1,
    }) } });
    await settle();
    expect(showNotification).toHaveBeenCalledWith('Meeting in ten minutes', { body: '', tag: 'jarvis', data: {} });
  });

  it('strips controls, collapses whitespace and preserves only nonempty body line breaks', async () => {
    const { showNotification, dispatch, settle } = createWorker();
    dispatch('push', { data: { json: () => ({
      v: 2,
      title: ' \u0000A \u202E  todo\tis\n due\u007F\u009F\uD800 ',
      body: '\r\n First \t task\u0000 \r\n\r\n Second \u202E task \rThird\u009F task\uDC00\u2028 +2\u200B  more \u2029ignored',
    }) } });
    await settle();
    expect(showNotification).toHaveBeenCalledWith('A todo is due', {
      body: 'First task\nSecond task\nThird task\n+2 more', tag: 'jarvis', data: {},
    });
  });

  it('truncates title and individual lines by code point without splitting emoji', async () => {
    const { showNotification, dispatch, settle } = createWorker();
    dispatch('push', { data: { json: () => ({
      v: 2, title: '😀'.repeat(80), body: `${'🦊'.repeat(100)}\nShort line`,
    }) } });
    await settle();
    expect(showNotification).toHaveBeenCalledWith(`${'😀'.repeat(59)}…`, {
      body: `${'🦊'.repeat(79)}…\nShort line`, tag: 'jarvis', data: {},
    });
  });

  it('caps the entire Unicode body at 240 code points including newlines and ellipsis', async () => {
    const { showNotification, dispatch, settle } = createWorker();
    dispatch('push', { data: { json: () => ({
      v: 2, title: 'Tasks', body: Array(4).fill('😀'.repeat(100)).join('\n'),
    }) } });
    await settle();
    const body = showNotification.mock.calls[0]?.[1]?.body ?? '';
    expect(body).toBe(`${'😀'.repeat(79)}…\n${'😀'.repeat(79)}…\n${'😀'.repeat(77)}…`);
    expect(Array.from(body)).toHaveLength(240);
    expect(body.split('\n').every((line) => Array.from(line).length <= 80)).toBe(true);
    expect(body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  });

  it('keeps text exactly at the title, line and total limits without ellipsis', async () => {
    const title = '😀'.repeat(60);
    const body = `${'🦊'.repeat(80)}\n${'x'.repeat(80)}\n${'y'.repeat(78)}`;
    const { showNotification, dispatch, settle } = createWorker();
    dispatch('push', { data: { json: () => ({ v: 2, title, body }) } });
    await settle();
    expect(showNotification).toHaveBeenCalledWith(title, { body, tag: 'jarvis', data: {} });
  });

  it.each([
    { title: '', body: 'Task' },
    { title: ' \u0000\u202E\n ', body: 'Task' },
    { title: '\uD800', body: 'Task' },
    { title: 'Jarvis', body: 'Task' },
    { title: ' \u0000jArViS\u202E ', body: 'Task' },
    { title: null, body: 'Task' },
    { title: 123, body: 'Task' },
    { title: ['Tasks'], body: 'Task' },
    { title: 'Tasks', body: null },
    { title: 'Tasks', body: 123 },
    { title: 'Tasks', body: ['Task'] },
    { title: 'Tasks' },
  ])('falls back to legacy titles for malformed v2 text %#, never Jarvis', async (invalid) => {
    const { showNotification, dispatch, settle } = createWorker();
    dispatch('push', { data: { json: () => ({ v: 2, itemId, kind: 'overdue', lang: 'en', count: 1, ...invalid }) } });
    dispatch('push', { data: { json: () => ({ v: 2, ...invalid }) } });
    await settle();
    expect(showNotification).toHaveBeenNthCalledWith(1, 'A todo is overdue', { body: '', tag: itemId, data: { itemId } });
    expect(showNotification).toHaveBeenNthCalledWith(2, 'New item', { body: '', tag: 'jarvis', data: {} });
    expect(showNotification.mock.calls.every(([title]) => title.toLowerCase() !== 'jarvis')).toBe(true);
  });

  it.each([null, [], 'unknown', 2, { v: 3, title: 'Private text', body: 'Private body' }])(
    'uses a generic title for unknown payload %#', async (payload) => {
      const { showNotification, dispatch, settle } = createWorker();
      dispatch('push', { data: { json: () => payload } });
      await settle();
      expect(showNotification).toHaveBeenCalledWith('New item', { body: '', tag: 'jarvis', data: {} });
    },
  );

  it.each(['https://example.invalid/path', '../settings', null, 123])(
    'preserves safe tags and data for invalid v2 item ids %#', async (invalidId) => {
      const { showNotification, dispatch, settle } = createWorker();
      dispatch('push', { data: { json: () => ({ v: 2, title: 'Tasks', body: 'Task', itemId: invalidId }) } });
      await settle();
      expect(showNotification).toHaveBeenCalledWith('Tasks', { body: 'Task', tag: 'jarvis', data: {} });
    },
  );

  it('navigates and focuses an existing same-origin window only for a valid item id', async () => {
    const focus = vi.fn(async () => {});
    const navigate = vi.fn(async () => ({ focus }));
    const openWindow = vi.fn(async () => {});
    const client = { navigate, focus };
    const { dispatch, settle } = createWorker({
      matchAll: vi.fn(async () => [client]),
      openWindow,
    });
    const close = vi.fn();
    dispatch('notificationclick', { notification: { close, data: { itemId } } });
    await settle();

    expect(close).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(`/proactive/${itemId}`);
    expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('tries the next window after failed navigation and focuses the navigated destination', async () => {
    const focus = vi.fn(async () => {});
    const failedNavigate = vi.fn(async () => { throw new Error('Window closed'); });
    const emptyNavigate = vi.fn(async () => null);
    const navigate = vi.fn(async () => ({ focus }));
    const matchAll = vi.fn(async () => [
      { navigate: failedNavigate }, { navigate: emptyNavigate }, { navigate },
    ]);
    const openWindow = vi.fn(async () => {});
    const { dispatch, settle } = createWorker({ matchAll, openWindow });
    dispatch('notificationclick', { notification: { close: vi.fn(), data: { itemId } } });
    await settle();
    expect(matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    expect(failedNavigate).toHaveBeenCalledWith(`/proactive/${itemId}`);
    expect(emptyNavigate).toHaveBeenCalledWith(`/proactive/${itemId}`);
    expect(navigate).toHaveBeenCalledWith(`/proactive/${itemId}`);
    expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens the valid item route when no existing window can navigate', async () => {
    const openWindow = vi.fn(async () => {});
    const { dispatch, settle } = createWorker({
      matchAll: vi.fn(async () => [{ navigate: vi.fn(async () => null) }]), openWindow,
    });
    dispatch('notificationclick', { notification: { close: vi.fn(), data: { itemId } } });
    await settle();
    expect(openWindow).toHaveBeenCalledWith(`/proactive/${itemId}`);
  });

  it.each([
    { itemId: 'https://example.invalid/path', path: '/' },
    { itemId: '../settings', path: '/' },
    { itemId: null, path: '/' },
  ])('opens only a safe fallback for invalid notification data $itemId', async ({ itemId: invalidId, path }) => {
    const openWindow = vi.fn(async () => {});
    const { dispatch, settle } = createWorker({ matchAll: vi.fn(async () => []), openWindow });
    const close = vi.fn();
    dispatch('notificationclick', { notification: { close, data: { itemId: invalidId } } });
    await settle();

    expect(close).toHaveBeenCalledOnce();
    expect(openWindow).toHaveBeenCalledWith(path);
  });

  it('takes over during install and activation', async () => {
    const { scope, dispatch, settle } = createWorker();
    dispatch('install');
    dispatch('activate');
    await settle();
    expect(scope.skipWaiting).toHaveBeenCalledOnce();
    expect(scope.clients.claim).toHaveBeenCalledOnce();
  });
});

describe('Static Web App worker configuration', () => {
  it('serves the worker without the SPA rewrite and prevents cached worker updates', () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'public/staticwebapp.config.json'), 'utf8')) as {
      routes: Array<{ route: string; headers?: Record<string, string> }>;
      navigationFallback: { exclude: string[] };
    };
    const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(config.navigationFallback.exclude).toContain('/sw.js');
    expect(config.routes).toContainEqual({
      route: '/sw.js',
      headers: { 'Cache-Control': 'no-cache' },
    });
    expect(indexHtml).not.toMatch(/http-equiv=["']Content-Security-Policy/i);
    expect(JSON.stringify(config)).not.toMatch(/content-security-policy/i);
  });
});
