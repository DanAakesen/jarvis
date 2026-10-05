import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createConversationStore } from './conversation-store.js';

function fixture(queryResult = { recordset: [], recordsets: [], rowsAffected: [] as number[] }) {
  const query = vi.fn(async () => queryResult);
  const input = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  return { store: createConversationStore(pool), pool, input, query };
}

describe('SQL conversation store', () => {
  it('creates a session with the requested channel and language', async () => {
    const startedAt = new Date('2026-10-03T12:00:00Z');
    const { store, pool, input, query } = fixture({
      recordset: [{ id: '41', channel: 'voice', language: 'da', started_at: startedAt, ended_at: null }],
      recordsets: [],
      rowsAffected: [1],
    });

    await expect(store.createSession({ channel: 'voice', language: 'da' })).resolves.toEqual({
      id: '41',
      channel: 'voice',
      language: 'da',
      startedAt,
      endedAt: null,
    });

    expect(pool.request).toHaveBeenCalledOnce();
    expect(input).toHaveBeenNthCalledWith(1, 'channel', sql.NVarChar(16), 'voice');
    expect(input).toHaveBeenNthCalledWith(2, 'language', sql.NVarChar(8), 'da');
    expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO dbo.jarvis_sessions');
  });

  it('loads the session channel, language, and active state', async () => {
    const startedAt = new Date('2026-10-03T12:00:00Z');
    const endedAt = null;
    const { store, input, query } = fixture({
      recordset: [{ id: '41', channel: 'chat', language: 'en', started_at: startedAt, ended_at: endedAt }],
      recordsets: [],
      rowsAffected: [],
    });

    await expect(store.getSession('41')).resolves.toEqual({
      id: '41', channel: 'chat', language: 'en', startedAt, endedAt,
    });
    expect(input).toHaveBeenCalledWith('sessionId', sql.BigInt, 41n);
    expect(query.mock.calls[0]?.[0]).toContain('FROM dbo.jarvis_sessions WHERE id = @sessionId');
  });

  it('stores a message only while its session remains active', async () => {
    const at = new Date('2026-10-03T12:01:00Z');
    const { store, input, query } = fixture({
      recordset: [{ id: '42', session_id: '41', role: 'dan', text: 'Hello', model: null, at }],
      recordsets: [],
      rowsAffected: [1],
    });

    await expect(store.addMessage({
      sessionId: '41',
      role: 'dan',
      text: 'Hello',
      model: null,
    })).resolves.toEqual({
      id: '42',
      sessionId: '41',
      role: 'dan',
      text: 'Hello',
      model: null,
      at,
    });

    expect(input).toHaveBeenNthCalledWith(1, 'sessionId', sql.BigInt, 41n);
    expect(input).toHaveBeenNthCalledWith(2, 'role', sql.NVarChar(16), 'dan');
    expect(input).toHaveBeenNthCalledWith(3, 'text', sql.NVarChar(sql.MAX), 'Hello');
    expect(input).toHaveBeenNthCalledWith(4, 'model', sql.NVarChar(100), null);
    expect(query.mock.calls[0]?.[0]).toContain('ended_at IS NULL');
  });

  it('updates an existing user message when a partial becomes final', async () => {
    const at = new Date('2026-10-03T12:01:00Z');
    const { store, input, query } = fixture({
      recordset: [{ id: '42', session_id: '41', role: 'dan', text: 'Open my browser, go to Google', model: null, at }],
      recordsets: [],
      rowsAffected: [1],
    });

    await expect(store.updateMessage!('42', 'Open my browser, go to Google')).resolves.toEqual({
      id: '42',
      sessionId: '41',
      role: 'dan',
      text: 'Open my browser, go to Google',
      model: null,
      at,
    });

    expect(input).toHaveBeenNthCalledWith(1, 'messageId', sql.BigInt, 42n);
    expect(input).toHaveBeenNthCalledWith(2, 'text', sql.NVarChar(sql.MAX), 'Open my browser, go to Google');
    expect(query.mock.calls[0]?.[0]).toContain("WHERE id = @messageId AND role = N'dan'");
  });

  it('returns only a bounded older page and attaches tool-call references', async () => {
    const { store, input, query } = fixture({
      recordset: [],
      recordsets: [
        [
          { id: '10', session_id: '1', channel: 'chat', language: 'da', role: 'dan', text: 'Older', model: null, voice_minutes: null, at: new Date('2026-10-03T12:00:00Z') },
          { id: '11', session_id: '1', channel: 'voice', language: 'en', role: 'jarvis', text: 'Started', model: 'gpt-realtime-2.1', voice_minutes: 2.5, at: new Date('2026-10-03T12:01:00Z') },
          { id: '12', session_id: '1', channel: 'chat', language: 'da', role: 'dan', text: 'Newest', model: null, voice_minutes: null, at: new Date('2026-10-03T12:02:00Z') },
        ],
        [
          { id: '90', message_id: '11', tool: 'factory_create_task', outcome: 'ok', task_id: '77' },
          { id: '91', message_id: '12', tool: 'factory_list_tasks', outcome: 'refused', task_id: null },
        ],
      ],
      rowsAffected: [],
    });

    await expect(store.getHistory({ limit: 2, before: '15' })).resolves.toEqual({
      messages: [
        {
          id: '11',
          sessionId: '1',
          channel: 'voice',
          language: 'en',
          role: 'jarvis',
          text: 'Started',
          model: 'gpt-realtime-2.1',
          voiceMinutes: 2.5,
          at: new Date('2026-10-03T12:01:00Z'),
          toolCalls: [{ id: '90', tool: 'factory_create_task', outcome: 'ok', taskId: '77' }],
        },
        {
          id: '12',
          sessionId: '1',
          channel: 'chat',
          language: 'da',
          role: 'dan',
          text: 'Newest',
          model: null,
          voiceMinutes: null,
          at: new Date('2026-10-03T12:02:00Z'),
          toolCalls: [{ id: '91', tool: 'factory_list_tasks', outcome: 'refused', taskId: null }],
        },
      ],
      nextCursor: '11',
    });

    expect(input).toHaveBeenNthCalledWith(1, 'take', sql.Int, 3);
    expect(input).toHaveBeenNthCalledWith(2, 'beforeId', sql.BigInt, 15n);
    expect(query.mock.calls[0]?.[0]).toContain('INNER JOIN @history AS h');
  });

  it('ends a session idempotently and reports unknown sessions', async () => {
    const { store, input, query } = fixture({
      recordset: [{ session_exists: 1 }],
      recordsets: [],
      rowsAffected: [0],
    });

    await expect(store.endSession('41')).resolves.toBe(true);
    expect(input).toHaveBeenCalledWith('sessionId', sql.BigInt, 41n);
    expect(query.mock.calls[0]?.[0]).toContain('ended_at IS NULL');
    const missing = fixture({ recordset: [{ session_exists: 0 }], recordsets: [], rowsAffected: [0] });
    await expect(missing.store.endSession('42')).resolves.toBe(false);
    expect(query.mock.calls[0]?.[0]).toContain("INSERT INTO dbo.usage (jarvis_session_id, source, metric, quantity, source_event_id, at)");
    expect(query.mock.calls[0]?.[0]).toContain('DATEDIFF_BIG(MILLISECOND, started_at, ended_at)');
    expect(query.mock.calls[0]?.[0]).toContain("WHERE channel = N'voice'");
  });
});
