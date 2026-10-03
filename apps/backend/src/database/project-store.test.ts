import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createProjectStore } from './project-store.js';

function fakePool(result: Record<string, unknown> = {}) {
  const query = vi.fn(async () => result);
  const input = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  return { pool, query, input };
}

describe('SQL project store', () => {
  it('lists only active projects with a stable textual ID', async () => {
    const { pool, query } = fakePool({ recordset: [{ id: '42', active: true }] });
    const projects = await createProjectStore(pool).list();
    expect(projects).toEqual([{ id: '42', active: true }]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE active = 1 ORDER BY name, id'));
    expect(query.mock.calls[0]?.[0]).toContain('CONVERT(varchar(20), id) AS id');
  });

  it('binds project fields and returns the inserted row', async () => {
    const row = { id: '42', repo: 'DanAakesen/jarvis', active: true };
    const { pool, query, input } = fakePool({ recordset: [row] });
    const created = await createProjectStore(pool).create({
      name: 'Jarvis', repo: row.repo, default_branch: 'main', default_agent: 'copilot', policy: 'deliver_pr',
      sandbox_size: '1x2', tech: 'node',
    });
    expect(created).toEqual(row);
    expect(input).toHaveBeenCalledWith('repo', sql.NVarChar(140), row.repo);
    expect(input).toHaveBeenCalledWith('maxParallelTasks', sql.Int, 1);
    expect(query.mock.calls[0]?.[0]).toContain('OUTPUT CONVERT(varchar(20), INSERTED.id) AS id');
    expect(query.mock.calls[0]?.[0]).toContain('@repo');
  });

  it('updates named fields using bound values and archives by ID', async () => {
    const updateResult = { recordset: [{ id: '42', max_parallel_tasks: 4 }] };
    const { pool, query, input } = fakePool(updateResult);
    const store = createProjectStore(pool);
    expect(await store.update('42', { max_parallel_tasks: 4 })).toEqual(updateResult.recordset[0]);
    expect(input).toHaveBeenCalledWith('id', sql.BigInt, 42n);
    expect(input).toHaveBeenCalledWith('maxParallelTasks', sql.Int, 4);
    expect(query.mock.calls[0]?.[0]).toContain('SET max_parallel_tasks = @maxParallelTasks');
    expect(query.mock.calls[0]?.[0]).toContain('WHERE id = @id AND active = 1');

    query.mockResolvedValueOnce({ rowsAffected: [1] } as never);
    expect(await store.archive('42')).toBe(true);
    expect(query.mock.calls[1]?.[0]).toContain('SET active = 0 WHERE id = @id');
  });

  it('translates only unique-constraint violations into repository conflicts', async () => {
    const { pool, query } = fakePool();
    query.mockRejectedValueOnce(Object.assign(new Error(), { number: 2627 }));
    await expect(createProjectStore(pool).create({
      name: 'Jarvis', repo: 'DanAakesen/jarvis', default_branch: 'main', default_agent: 'copilot',
      policy: 'deliver_pr', sandbox_size: '1x2', tech: 'node',
    })).rejects.toThrow('Project repository already exists');
    query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(createProjectStore(pool).list()).rejects.toThrow('database unavailable');
  });
});
