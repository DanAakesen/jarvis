import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createPhoneSessionStore } from './phone-session-store.js';

const callerId = '12bcfab7-49ba-4cf7-8be7-780a13911f93';

function fixture(result = { recordset: [], rowsAffected: [1] as number[] }) {
  const query = vi.fn(async () => result);
  const input = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  return { store: createPhoneSessionStore(pool), input, query };
}

describe('phone call session store', () => {
  it('creates the transcript and call records in one idempotent transaction', async () => {
    const { store, input, query } = fixture({
      recordset: [{
        session_id: '42', call_id: 'server-call-1', caller_id: callerId,
        call_connection_id: null, status: 'answering',
      }],
      rowsAffected: [1],
    });

    await expect(store.create({
      eventId: 'event-1',
      callId: 'server-call-1',
      callerId,
    })).resolves.toEqual({
      sessionId: '42',
      callId: 'server-call-1',
      callerId,
      callConnectionId: null,
      status: 'answering',
    });
    expect(input).toHaveBeenCalledWith('eventId', sql.VarChar(128), 'event-1');
    expect(input).toHaveBeenCalledWith('callId', sql.VarChar(128), 'server-call-1');
    expect(query.mock.calls[0]?.[0]).toContain('BEGIN TRANSACTION');
    expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO dbo.phone_sessions');
  });

  it('returns no session when Event Grid redelivers a unique call event', async () => {
    const { store, query } = fixture();
    query.mockRejectedValue(Object.assign(new Error('duplicate'), { number: 2627 }));
    await expect(store.create({ eventId: 'event-1', callId: 'call-1', callerId })).resolves.toBeNull();
  });

  it('validates identifiers and only activates an answering session', async () => {
    const { store, input, query } = fixture({ recordset: [], rowsAffected: [1] });
    await expect(store.create({ eventId: 'bad event', callId: 'call-1', callerId })).rejects.toThrow();
    expect(await store.activate('1', 'call-connection-1')).toBe(true);
    expect(input).toHaveBeenCalledWith('callConnectionId', sql.NVarChar(256), 'call-connection-1');
    expect(query.mock.calls[0]?.[0]).toContain("status = 'answering'");
    await expect(store.activate('1', 'bad\nconnection')).resolves.toBe(false);
  });

  it('validates an active phone session against the verified caller', async () => {
    const { store, query, input } = fixture();
    query.mockResolvedValueOnce({ recordset: [{ active: 1 }], rowsAffected: [1] });
    query.mockResolvedValueOnce({ recordset: [], rowsAffected: [0] });
    await expect(store.isActive('42', callerId)).resolves.toBe(true);
    expect(input).toHaveBeenCalledWith('callerId', sql.NVarChar(64), callerId);
    expect(query.mock.calls[0]?.[0]).toContain("caller_id = @callerId AND status = 'active'");
    await expect(store.isActive('42', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).resolves.toBe(false);
    await expect(store.isActive('bad', callerId)).resolves.toBe(false);
  });

  it('finishes phone and conversation sessions together and lists active calls', async () => {
    const activeRows = [{
      session_id: '42', call_id: 'call-1', caller_id: callerId,
      call_connection_id: 'connection-1', status: 'active' as const,
    }];
    const query = vi.fn()
      .mockResolvedValueOnce({ rowsAffected: [1] })
      .mockResolvedValueOnce({ recordset: activeRows });
    const request = { input: vi.fn().mockReturnThis(), query };
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
    const store = createPhoneSessionStore(pool);

    await store.finish('42', 'ended');
    expect(query.mock.calls[0]?.[0]).toContain('BEGIN TRANSACTION');
    expect(query.mock.calls[0]?.[0]).toContain('dbo.jarvis_sessions');
    await expect(store.active()).resolves.toEqual([{
      sessionId: '42',
      callId: 'call-1',
      callerId,
      callConnectionId: 'connection-1',
      status: 'active',
    }]);
  });

  it('returns a bounded newest-first call history without caller identifiers', async () => {
    const query = vi.fn(async () => ({
      recordset: [
        {
          started_at: new Date('2026-10-07T12:00:00.000Z'),
          duration_seconds: 120,
          status: 'ended',
        },
        {
          started_at: new Date('2026-10-07T11:00:00.000Z'),
          duration_seconds: 18,
          status: 'active',
        },
      ],
      rowsAffected: [2],
    }));
    const request = { input: vi.fn().mockReturnThis(), query };
    const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
    const store = createPhoneSessionStore(pool);

    await expect(store.recent()).resolves.toEqual([
      {
        startedAt: '2026-10-07T12:00:00.000Z',
        durationSeconds: 120,
        outcome: 'ended',
      },
      {
        startedAt: '2026-10-07T11:00:00.000Z',
        durationSeconds: 18,
        outcome: 'in_progress',
      },
    ]);
    expect(request.input).toHaveBeenCalledWith('limit', sql.Int, 20);
    expect(query.mock.calls[0]?.[0]).toContain('SELECT TOP (@limit)');
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY started_at DESC, jarvis_session_id DESC');
    expect(query.mock.calls[0]?.[0]).not.toContain('caller_id');
  });

  it('rejects unbounded call-history limits before querying', async () => {
    const { store, query } = fixture();
    await expect(store.recent(0)).rejects.toThrow('Invalid phone call history limit');
    await expect(store.recent(51)).rejects.toThrow('Invalid phone call history limit');
    await expect(store.recent(1.5)).rejects.toThrow('Invalid phone call history limit');
    expect(query).not.toHaveBeenCalled();
  });
});
