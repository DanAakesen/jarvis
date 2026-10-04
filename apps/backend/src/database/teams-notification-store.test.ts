import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createTeamsNotificationStore } from './teams-notification-store.js';

function fakePool(results: Array<Record<string, unknown>> = []) {
  const query = vi.fn(async () => ({ recordset: results.splice(0, 1) }));
  const input = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  return { pool: { request: vi.fn(() => request) } as unknown as sql.ConnectionPool, input, query };
}

const reference = {
  channelId: 'msteams',
  serviceUrl: 'https://smba.trafficmanager.net/teams/',
  conversation: { id: 'conversation-1', conversationType: 'personal', tenantId: '802efa29-17f2-4a79-8f5f-38f087aed96a' },
  user: {
    id: 'user-1',
    aadObjectId: '12bcfab7-49ba-4cf7-8be7-780a13911f93',
    tenantId: '802efa29-17f2-4a79-8f5f-38f087aed96a',
    role: 'user',
  },
  bot: { id: 'bot-1', role: 'bot' },
} as const;

describe('Teams notification SQL store', () => {
  it('stores a reduced personal conversation reference and reads it back only for its owner', async () => {
    const { pool, input, query } = fakePool();
    const store = createTeamsNotificationStore(pool);
    await store.saveConversation(reference.user.aadObjectId, reference);
    expect(input).toHaveBeenCalledWith('referenceJson', sql.NVarChar(4000), expect.any(String));
    expect(query.mock.calls[0]?.[0]).toContain('MERGE dbo.teams_conversations');

    const read = createTeamsNotificationStore(fakePool([{ reference_json: JSON.stringify(reference) }]).pool);
    expect(await read.getConversation(reference.user.aadObjectId)).toMatchObject({
      channelId: 'msteams',
      conversation: { id: 'conversation-1', conversationType: 'personal' },
    });
  });

  it('rejects unsafe service URLs and mismatched owner references', async () => {
    const { pool } = fakePool();
    const store = createTeamsNotificationStore(pool);
    await expect(store.saveConversation(reference.user.aadObjectId, {
      ...reference, serviceUrl: 'http://127.0.0.1',
    })).rejects.toThrow('Invalid Teams conversation reference');
    await expect(store.saveConversation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', reference))
      .rejects.toThrow('Invalid Teams conversation reference');
  });

  it('binds confirmations and atomically resolves and consumes only an unexpired approval', async () => {
    const { pool, input, query } = fakePool([{}, { status: 'approved' }, { status: 'executing' }]);
    const store = createTeamsNotificationStore(pool);
    await store.createConfirmation('A'.repeat(43), reference.user.aadObjectId, 'conversation-1', 'merge', 300);
    expect(input).toHaveBeenCalledWith('lifetimeSeconds', sql.Int, 300);
    expect(query.mock.calls[0]?.[0]).toContain("VALUES\n            (@confirmationId, @ownerObjectId, @conversationId, @actionKind, 'pending'");
    await expect(store.resolveConfirmation(
      'A'.repeat(43), reference.user.aadObjectId, 'conversation-1', 'approve',
    )).resolves.toBe('approved');
    expect(query.mock.calls[1]?.[0]).toContain("status = 'pending'");
    await expect(store.consumeApproval('A'.repeat(43), reference.user.aadObjectId)).resolves.toBe(true);
    expect(query.mock.calls[2]?.[0]).toContain("expires_at > SYSUTCDATETIME()");
    expect(query.mock.calls[2]?.[0]).toContain("status = 'approved'");
  });

  it('does not consume unknown or expired approvals', async () => {
    const store = createTeamsNotificationStore(fakePool([{}]).pool);
    await expect(store.resolveConfirmation('B'.repeat(43), reference.user.aadObjectId, 'conversation-1', 'approve'))
      .resolves.toBeNull();
    const expired = createTeamsNotificationStore(fakePool([{ status: 'expired' }]).pool);
    await expect(expired.resolveConfirmation('B'.repeat(43), reference.user.aadObjectId, 'conversation-1', 'approve'))
      .resolves.toBe('expired');
  });
});
