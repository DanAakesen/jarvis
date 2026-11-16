import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import {
  createNotesFolderOrderModule, folderOrderProblem, maxOrderedFolders,
  type NotesFolderOrder, type NotesFolderOrderStore,
} from './folder-order.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const ownerToken = `${['Bear', 'er'].join('')} ${['a', 'b', 'c'].join('.')}`;
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function memoryStore() {
  const rows = new Map<string, readonly string[]>();
  const store: NotesFolderOrderStore = {
    async read(): Promise<NotesFolderOrder[]> { return [...rows].map(([parent, folders]) => ({ parent, folders })); },
    async replace(_owner, parent, folders) {
      if (folders.length === 0) rows.delete(parent);
      else rows.set(parent, folders);
    },
  };
  return { rows, store };
}

function fixture(options: { owner?: boolean; failing?: boolean } = {}) {
  const { rows, store } = memoryStore();
  const guarded: NotesFolderOrderStore = options.failing
    ? { read: async () => { throw new Error('down'); }, replace: async () => { throw new Error('down'); } }
    : store;
  const owner = options.owner === false
    ? { objectId: 'someone-else', tenantId: config.auth.tenantId, displayName: 'Other' }
    : { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' };
  const app = buildApp(config, undefined, { modules: [createNotesFolderOrderModule(guarded)], auth: async () => owner });
  apps.push(app);
  const put = (payload: unknown) => app.inject({ method: 'PUT', url: '/notes/folder-order', payload: payload as object, headers: { authorization: ownerToken } });
  const get = () => app.inject({ method: 'GET', url: '/notes/folder-order', headers: { authorization: ownerToken } });
  return { rows, put, get };
}

describe('manual folder order', () => {
  it('stores one order per parent folder, reads it back and leaves other parents alone', async () => {
    const { put, get } = fixture();
    expect((await get()).json()).toEqual({ orders: [] });
    expect((await put({ parent: '', folders: ['Work', 'Personal', 'General'] })).statusCode).toBe(200);
    expect((await put({ parent: 'Work', folders: ['Work/Projects', 'Work/Archive'] })).statusCode).toBe(200);
    expect((await put({ parent: '', folders: ['Personal', 'Work'] })).json()).toEqual({ parent: '', folders: ['Personal', 'Work'] });
    const read = await get();
    expect(read.headers['cache-control']).toContain('no-store');
    expect(read.json().orders).toEqual([
      { parent: '', folders: ['Personal', 'Work'] },
      { parent: 'Work', folders: ['Work/Projects', 'Work/Archive'] },
    ]);
  });

  it('clears a parent with an empty list', async () => {
    const { put, get } = fixture();
    await put({ parent: '', folders: ['Work'] });
    await put({ parent: '', folders: [] });
    expect((await get()).json()).toEqual({ orders: [] });
  });

  it('is owner only', async () => {
    const { put, get, rows } = fixture({ owner: false });
    expect((await get()).statusCode).toBe(403);
    expect((await put({ parent: '', folders: ['Work'] })).statusCode).toBe(403);
    expect(rows.size).toBe(0);
  });

  it('refuses anything that is not a direct child folder, and stores nothing', async () => {
    const { put, rows } = fixture();
    for (const body of [
      { parent: '', folders: ['Work/Projects'] },
      { parent: 'Work', folders: ['Personal'] },
      { parent: 'Work', folders: ['Work'] },
      { parent: '', folders: ['Work', 'Work'] },
      { parent: '', folders: ['.git'] },
      { parent: '', folders: ['..'] },
      { parent: '..', folders: [] },
      { parent: '', folders: ['a\\b'] },
      { parent: '', folders: ['a%2fb'] },
      { parent: '', folders: ['Re\u0301sume\u0301'] },
      { parent: '', folders: ['/Work'] },
      { parent: '', folders: [''] },
      { parent: '', folders: ['x'.repeat(181)] },
      { parent: '', folders: Array.from({ length: maxOrderedFolders + 1 }, (_value, index) => `f${index}`) },
    ]) {
      expect((await put(body)).statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(rows.size).toBe(0);
  });

  it('reports a store failure instead of pretending it saved', async () => {
    const { put, get } = fixture({ failing: true });
    expect((await put({ parent: '', folders: ['Work'] })).statusCode).toBe(503);
    expect((await get()).statusCode).toBe(503);
  });

  it('accepts unicode folder names in canonical form', () => {
    expect(folderOrderProblem('', ['Økonomi', 'Projekter'])).toBeUndefined();
    expect(folderOrderProblem('Work/Q4', ['Work/Q4/Plan'])).toBeUndefined();
  });
});
