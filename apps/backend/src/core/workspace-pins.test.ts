import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import {
  WorkspacePinLimitExceeded,
  type WorkspacePinStore,
} from '../database/workspace-pin-store.js';
import { createWorkspacePinsModule } from './workspace-pins.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const ownerId = config.auth.ownerObjectId;
const otherId = '1b475880-a077-40cd-90b7-3278bfc45b5b';
const view = {
  version: 1 as const,
  title: 'Research',
  renderer: 'text' as const,
  source: { id: 'research' as const, status: 'complete' as const },
  data: { format: 'plain' as const, content: 'Findings' },
};
const first = { viewId: 'research-report', view, pinnedAt: '2026-10-08T10:00:00.000Z' };
const second = { viewId: 'research-summary', view, pinnedAt: '2026-10-08T11:00:00.000Z' };
const apps: ReturnType<typeof buildApp>[] = [];
const authorization = (token: string) => ({ authorization: ['Bearer', token].join(' ') });

function fixture(initialPins: typeof first[] = [first]) {
  let pins = [...initialPins];
  const list = vi.fn(async () => [...pins].sort((left, right) => left.pinnedAt.localeCompare(right.pinnedAt)));
  const pin = vi.fn(async (_owner: string, viewId: string, newView: typeof view) => {
    const existing = pins.find((item) => item.viewId === viewId);
    if (existing) {
      const updated = { ...existing, view: newView };
      pins = pins.map((item) => item.viewId === viewId ? updated : item);
      return updated;
    }
    if (pins.length >= 20) throw new WorkspacePinLimitExceeded();
    const created = { viewId, view: newView, pinnedAt: '2026-10-08T12:00:00.000Z' };
    pins = [...pins, created];
    return created;
  });
  const unpin = vi.fn(async (_owner: string, viewId: string) => {
    const previousLength = pins.length;
    pins = pins.filter((item) => item.viewId !== viewId);
    return pins.length !== previousLength;
  });
  const auth: TokenVerifier = async (token) => {
    if (token === 'agent.e30.sig') return { kind: 'jarvis-agent', objectId: ownerId, tenantId: config.auth.tenantId };
    if (token === 'other.e30.sig') return { objectId: otherId, tenantId: config.auth.tenantId, displayName: 'Other' };
    return { objectId: ownerId, tenantId: config.auth.tenantId, displayName: 'Dan' };
  };
  const store = { list, pin, unpin } as unknown as WorkspacePinStore;
  const app = buildApp(config, undefined, { auth, modules: [createWorkspacePinsModule(store)] });
  apps.push(app);
  return { app, list, pin, unpin };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('workspace pin routes', () => {
  it('allows only the owner and returns pins oldest first', async () => {
    const data = fixture([second, first]);
    expect((await data.app.inject({ url: '/workspace/pins' })).statusCode).toBe(401);
    expect((await data.app.inject({ url: '/workspace/pins', headers: authorization('agent.e30.sig') })).statusCode).toBe(403);
    expect((await data.app.inject({ url: '/workspace/pins', headers: authorization('other.e30.sig') })).statusCode).toBe(403);

    const response = await data.app.inject({ url: '/workspace/pins', headers: authorization('owner.e30.sig') });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json()).toEqual({ pins: [first, second] });
    expect(data.list).toHaveBeenCalledWith(ownerId, expect.any(AbortSignal));
  });

  it('updates an existing pin without changing its original timestamp and rejects new pins at capacity', async () => {
    const data = fixture();
    const response = await data.app.inject({
      method: 'PUT',
      url: `/workspace/pins/${first.viewId}`,
      headers: authorization('owner.e30.sig'),
      payload: { view: { ...view, title: 'Updated research' } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().pin).toEqual({ ...first, view: { ...view, title: 'Updated research' } });
    expect(data.pin).toHaveBeenCalledWith(ownerId, first.viewId, { ...view, title: 'Updated research' }, expect.any(AbortSignal));

    const full = fixture(Array.from({ length: 20 }, (_item, index) => ({
      viewId: `pin-${index}`,
      view,
      pinnedAt: `2026-10-08T10:${String(index).padStart(2, '0')}:00.000Z`,
    })));
    const conflict = await full.app.inject({
      method: 'PUT',
      url: '/workspace/pins/new-pin',
      headers: authorization('owner.e30.sig'),
      payload: { view },
    });
    expect(conflict.statusCode).toBe(409);

    const fullRepin = fixture(Array.from({ length: 20 }, (_item, index) => ({
      viewId: `pin-${index}`,
      view,
      pinnedAt: `2026-10-08T10:${String(index).padStart(2, '0')}:00.000Z`,
    })));
    const existing = await fullRepin.app.inject({
      method: 'PUT',
      url: '/workspace/pins/pin-5',
      headers: authorization('owner.e30.sig'),
      payload: { view: { ...view, title: 'Updated at capacity' } },
    });
    expect(existing.statusCode).toBe(200);
    expect(existing.json().pin.pinnedAt).toBe('2026-10-08T10:05:00.000Z');
  });

  it('rejects invalid views, view IDs and oversized requests', async () => {
    const data = fixture();
    const invalidView = await data.app.inject({
      method: 'PUT',
      url: '/workspace/pins/research-report',
      headers: authorization('owner.e30.sig'),
      payload: { view: { ...view, renderer: 'script' } },
    });
    expect(invalidView.statusCode).toBe(400);

    const invalidId = await data.app.inject({
      method: 'PUT',
      url: '/workspace/pins/1-invalid',
      headers: authorization('owner.e30.sig'),
      payload: { view },
    });
    expect(invalidId.statusCode).toBe(400);

    const oversized = await data.app.inject({
      method: 'PUT',
      url: '/workspace/pins/research-report',
      headers: authorization('owner.e30.sig'),
      payload: { view: { ...view, data: { format: 'plain', content: 'x'.repeat(300_000) } } },
    });
    expect(oversized.statusCode).toBe(413);
  });

  it('deletes a pin with 204 and reports missing pins as 404', async () => {
    const data = fixture();
    expect((await data.app.inject({
      method: 'DELETE',
      url: `/workspace/pins/${first.viewId}`,
      headers: authorization('owner.e30.sig'),
    })).statusCode).toBe(204);
    expect((await data.app.inject({
      method: 'DELETE',
      url: `/workspace/pins/${first.viewId}`,
      headers: authorization('owner.e30.sig'),
    })).statusCode).toBe(404);
    expect(data.unpin).toHaveBeenCalledWith(ownerId, first.viewId, expect.any(AbortSignal));
  });
});
