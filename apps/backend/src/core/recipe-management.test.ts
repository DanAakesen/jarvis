import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import { coreModule } from './index.js';
import { createRecipeModule } from './recipe-management.js';
import { recipeId, type RecipeDraft, type RecipeStore } from './task-recipes.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bearer', 'a.b.c'].join(' ') };
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

function fixture(available = true, auth: TokenVerifier = async () => ({
  objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan',
})) {
  const draft: RecipeDraft = {
    kind: 'browser', key: 'https://site.test', goal: 'open search',
    steps: [{ operation: 'click', target: { role: 'button', name: 'Search' } }, { operation: 'done' }],
  };
  const recipe = { ...draft, id: recipeId(draft) };
  const store: RecipeStore = {
    list: vi.fn(async () => [recipe]),
    save: vi.fn(async () => {}),
    rename: vi.fn(async () => true),
    delete: vi.fn(async () => true),
  };
  const module = createRecipeModule(available ? store : undefined);
  const app = buildApp(config, undefined, {
    auth,
    modules: [coreModule, module],
  });
  apps.push(app);
  return { app, store, recipe, tool: module.tools[0]!, legacyTool: module.tools[1]! };
}

describe('recipe management', () => {
  it('requires authentication and lists bounded safe records without cache', async () => {
    const { app, recipe, store } = fixture();
    expect((await app.inject({ url: '/routines' })).statusCode).toBe(401);
    expect(store.list).not.toHaveBeenCalled();
    const response = await app.inject({ url: '/routines', headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ routines: [recipe] });
    expect((await app.inject({ url: '/recipes', headers })).json()).toEqual({ recipes: [recipe] });
  });
  it('renames and deletes only valid routines, with not-found and storage-unavailable states', async () => {
    const { app, store, recipe } = fixture();
    expect((await app.inject({ method: 'PATCH', url: `/routines/${recipe.id}` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PATCH', url: '/routines/invalid', headers, payload: { name: 'Search' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/routines/${recipe.id}`, headers, payload: { name: '  ' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/routines/${recipe.id}`, headers, payload: { name: 'private token' } })).statusCode).toBe(400);
    const rename = await app.inject({ method: 'PATCH', url: `/routines/${recipe.id}`, headers, payload: { name: 'Search' } });
    expect(rename.statusCode).toBe(200);
    expect(rename.headers['cache-control']).toBe('no-store');
    expect(rename.json()).toEqual({ updated: true });
    expect(store.rename).toHaveBeenCalledWith(recipe.id, 'Search');
    expect(store.rename).not.toHaveBeenCalledWith(recipe.id, 'private token');
    vi.mocked(store.rename).mockResolvedValue(false);
    expect((await app.inject({ method: 'PATCH', url: `/recipes/${recipe.id}`, headers, payload: { name: 'Search' } })).statusCode).toBe(404);
    expect(store.rename).toHaveBeenCalledTimes(2);
    expect(store.delete).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'DELETE', url: `/routines/${recipe.id}`, headers })).statusCode).toBe(204);
    expect(store.delete).toHaveBeenCalledWith(recipe.id);
    vi.mocked(store.delete).mockResolvedValue(false);
    expect((await app.inject({ method: 'DELETE', url: `/recipes/${recipe.id}`, headers })).statusCode).toBe(404);
    const unavailable = fixture(false);
    expect((await unavailable.app.inject({ url: '/routines', headers })).statusCode).toBe(503);
    expect((await unavailable.app.inject({ method: 'PATCH', url: `/routines/${recipe.id}`, headers, payload: { name: 'Search' } })).statusCode).toBe(503);
    expect((await unavailable.app.inject({ method: 'DELETE', url: `/routines/${recipe.id}`, headers })).statusCode).toBe(503);
  });
  it('exposes sensitive routine tools and a backward-compatible recipes tool', async () => {
    const { app, tool, legacyTool, recipe } = fixture();
    const catalogue = (await app.inject({ url: '/tools', headers })).json() as { name: string }[];
    expect(catalogue.some(item => item.name === 'task_routines')).toBe(true);
    expect(catalogue.some(item => item.name === 'task_recipes')).toBe(true);
    expect(tool.sensitive).toBe(true);
    const request = {} as Parameters<typeof tool.execute>[1];
    const signal = new AbortController().signal;
    expect(await tool.execute({ action: 'list' }, request, signal)).toEqual({ routines: [recipe] });
    expect(await tool.execute({ action: 'delete', id: recipe.id }, request, signal)).toEqual({ deleted: true });
    expect(await tool.execute({ action: 'rename', id: recipe.id, name: 'Find search' }, request, signal)).toEqual({ updated: true });
    expect(await tool.execute({ action: 'update', id: recipe.id, name: 'Find search' }, request, signal)).toEqual({ updated: true });
    await expect(tool.execute({ action: 'delete' }, request, signal)).rejects.toThrow('routine ID');
    await expect(tool.execute({ action: 'list', id: recipe.id }, request, signal)).rejects.toThrow('Choose list');
    expect(await legacyTool.execute({ action: 'list' }, request, signal)).toEqual({ recipes: [recipe] });
  });
  it('does not expose storage exception details', async () => {
    const { app, store } = fixture();
    vi.mocked(store.list).mockRejectedValue(new Error('private storage details'));
    const response = await app.inject({ url: '/routines', headers });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('private');
  });
  it.each(['jarvis-agent', 'jarvis-runner', 'jarvis-pc-bridge'] as const)(
    'rejects %s identities on Dan-only recipe routes', async kind => {
      const { app, store, recipe } = fixture(true, async () => ({
        kind, objectId: 'offline-service', tenantId: config.auth.tenantId,
      }));
      expect((await app.inject({ url: '/routines', headers })).statusCode).toBe(403);
      expect((await app.inject({ method: 'DELETE', url: `/routines/${recipe.id}`, headers })).statusCode).toBe(403);
      expect(store.list).not.toHaveBeenCalled();
      expect(store.delete).not.toHaveBeenCalled();
    },
  );
});
