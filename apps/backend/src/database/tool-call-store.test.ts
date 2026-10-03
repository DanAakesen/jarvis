import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createToolCallStore } from './tool-call-store.js';

describe('SQL tool-call store', () => {
  it('binds the tool call fields and writes the completion time in UTC', async () => {
    const query = vi.fn(async () => ({ recordset: [] }));
    const input = vi.fn();
    const request = { input, query };
    input.mockReturnValue(request);
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;

    await createToolCallStore(pool).record({
      messageId: '42',
      tool: 'factory_create_task',
      arguments: { task: 'example' },
      result: { taskId: 7 },
      outcome: 'ok',
    });

    expect(pool.request).toHaveBeenCalledOnce();
    expect(input).toHaveBeenNthCalledWith(1, 'messageId', sql.BigInt, 42n);
    expect(input).toHaveBeenNthCalledWith(2, 'tool', sql.NVarChar(64), 'factory_create_task');
    expect(input).toHaveBeenNthCalledWith(3, 'arguments', sql.NVarChar(sql.MAX), '{"task":"example"}');
    expect(input).toHaveBeenNthCalledWith(4, 'result', sql.NVarChar(sql.MAX), '{"taskId":7}');
    expect(input).toHaveBeenNthCalledWith(5, 'outcome', sql.NVarChar(16), 'ok');
    expect(query).toHaveBeenCalledWith(expect.stringContaining(
      'INSERT INTO dbo.tool_calls (message_id, tool, [arguments], result, outcome, at)',
    ));
    expect(query.mock.calls[0]?.[0]).toContain('SYSUTCDATETIME()');
  });

  it('does not attempt to store values that cannot be represented as JSON', async () => {
    const query = vi.fn(async () => ({ recordset: [] }));
    const input = vi.fn();
    const request = { input, query };
    input.mockReturnValue(request);
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;

    await expect(createToolCallStore(pool).record({
      messageId: '42', tool: 'factory_create_task', arguments: {}, result: 1n, outcome: 'ok',
    })).rejects.toThrow('Tool call data is not JSON serializable');
    expect(query).not.toHaveBeenCalled();
  });
});
