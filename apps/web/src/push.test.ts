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
    expect(showNotification).toHaveBeenNthCalledWith(1, 'Jarvis', {
      body: 'New item', tag: itemId, data: { itemId },
    });
    for (const call of showNotification.mock.calls.slice(1)) {
      expect(call[0]).toBe('Jarvis');
      expect(call[1]).toMatchObject({ body: 'New item', tag: 'jarvis', data: {} });
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
  ] as const)('uses a fixed %s/%s message for count %i', async (kind, lang, count, body) => {
    const { showNotification, dispatch, settle } = createWorker();
    dispatch('push', { data: { json: () => ({ itemId, kind, lang, count, body: 'Synthetic secret text' }) } });
    await settle();
    expect(showNotification).toHaveBeenCalledWith('Jarvis', {
      body, tag: itemId, data: { itemId },
    });
    expect(JSON.stringify(showNotification.mock.calls)).not.toContain('Synthetic secret text');
  });

  it.each([0, 100, 1.5, '2', Number.NaN, undefined])('uses generic text for invalid count %s', async (count) => {
    const { showNotification, dispatch, settle } = createWorker();
    dispatch('push', { data: { json: () => ({ itemId, kind: 'alert', lang: 'en', ...(count === undefined ? {} : { count }) }) } });
    await settle();
    expect(showNotification).toHaveBeenCalledWith('Jarvis', { body: 'New item', tag: itemId, data: { itemId } });
  });

  it.each([
    { kind: 'unknown', lang: 'en', count: 1 },
    { kind: 'alert', lang: 'unknown', count: 1 },
    { kind: 'mixed', lang: 'en', count: 1 },
  ])('uses generic text for invalid template input %#', async (invalid) => {
    const { showNotification, dispatch, settle } = createWorker();
    dispatch('push', { data: { json: () => ({ itemId, ...invalid }) } });
    await settle();
    expect(showNotification).toHaveBeenCalledWith('Jarvis', { body: 'New item', tag: itemId, data: { itemId } });
  });

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
