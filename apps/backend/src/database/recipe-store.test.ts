import sql from 'mssql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecipeStore } from './recipe-store.js';
import { recipeId, type RecipeDraft } from '../core/task-recipes.js';

afterEach(() => { vi.restoreAllMocks(); });
const draft: RecipeDraft = {
  kind: 'pc', key: 'sampleapp', goal: 'open search',
  steps: [{ operation: 'click', target: { role: 'button', name: 'Search' } }, { operation: 'done' }],
};

function fixture() {
  const request = {
    input: vi.fn().mockReturnThis(),
    query: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] }),
    cancel: vi.fn(),
  };
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  const transaction = {
    begin: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    request: vi.fn(() => request),
  };
  vi.spyOn(sql, 'Transaction').mockImplementation(function () { return transaction as unknown as sql.Transaction; });
  return { request, transaction, store: createRecipeStore(pool) };
}

describe('SQL recipe store', () => {
  it('uses the existing global settings scope with bound app filters and caps reads', async () => {
    const { request, store } = fixture();
    const recipe = { ...draft, id: recipeId(draft) };
    request.query.mockResolvedValue({
      recordset: [
        { value: JSON.stringify(recipe) },
        { value: 'invalid' },
        { value: JSON.stringify({ ...recipe, text: 'private' }) },
        { value: 'x'.repeat(32_769) },
      ],
      rowsAffected: [],
    });
    expect(await store.list({ kind: 'pc', key: 'sampleapp' })).toEqual([recipe]);
    expect(request.input).toHaveBeenCalledWith('appKey', expect.anything(), 'sampleapp');
    expect(request.input).toHaveBeenCalledWith('prefix', expect.anything(), 'recipe.%');
    expect(request.query.mock.calls[0]![0]).toContain('TOP (100)');
    expect(request.query.mock.calls[0]![0]).toContain("scope = N'global'");
  });
  it('serializes bounded upserts and never rewrites migrations or other settings', async () => {
    const { request, transaction, store } = fixture();
    await store.save(draft);
    expect(request.input).toHaveBeenCalledWith('key', expect.anything(), `recipe.${recipeId(draft)}`);
    expect(request.query.mock.calls[0]![0]).toContain('sys.sp_getapplock');
    expect(request.query.mock.calls[0]![0]).toContain('>= 100');
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
  it('rolls back and sanitizes storage failures and rejects unsafe drafts', async () => {
    const { request, transaction, store } = fixture();
    request.query.mockRejectedValue(new Error('private database error'));
    await expect(store.save(draft)).rejects.toThrow('Task recipe could not be saved');
    expect(transaction.rollback).toHaveBeenCalledOnce();
    await expect(store.save({ ...draft, goal: 'password private' })).rejects.toThrow('Invalid task recipe');
  });
  it('cancels writes and rejects malformed delete IDs before querying', async () => {
    const { request, store } = fixture();
    const controller = new AbortController();
    request.query.mockImplementation(async () => { controller.abort(); return { recordset: [], rowsAffected: [1] }; });
    await expect(store.save(draft, controller.signal)).rejects.toThrow('could not be saved');
    expect(request.cancel).toHaveBeenCalledOnce();
    request.query.mockClear();
    await expect(store.delete('../private')).rejects.toThrow('Invalid task recipe ID');
    expect(request.query).not.toHaveBeenCalled();
    expect(await store.delete(recipeId(draft))).toBe(true);
    expect(request.input).toHaveBeenCalledWith('key', expect.anything(), `recipe.${recipeId(draft)}`);
  });
});
