import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createConfirmationStore } from './confirmation-store.js';

function fakePool(results: Array<Record<string, unknown>> = []) {
  const query = vi.fn(async () => ({ recordset: results.splice(0, 1) }));
  const input = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  return { pool: { request: vi.fn(() => request) } as unknown as sql.ConnectionPool, input, query };
}

const ownerObjectId = '00000000-0000-4000-8000-000000000001';

describe('confirmation SQL store', () => {

  it('binds confirmations and atomically resolves and consumes only an unexpired approval', async () => {
    const { pool, input, query } = fakePool([{}, { status: 'approved' }, { status: 'executing' }]);
    const store = createConfirmationStore(pool);
    await store.createConfirmation('A'.repeat(43), ownerObjectId, 'browser', 'merge', 300);
    expect(input).toHaveBeenCalledWith('lifetimeSeconds', sql.Int, 300);
    expect(query.mock.calls[0]?.[0]).toContain("VALUES\n            (@confirmationId, @ownerObjectId, @conversationId, @actionKind, 'pending'");
    await expect(store.resolveConfirmation(
      'A'.repeat(43), ownerObjectId, 'browser', 'approve',
    )).resolves.toBe('approved');
    expect(query.mock.calls[1]?.[0]).toContain("status = 'pending'");
    await expect(store.consumeApproval('A'.repeat(43), ownerObjectId)).resolves.toBe(true);
    expect(query.mock.calls[2]?.[0]).toContain("expires_at > SYSUTCDATETIME()");
    expect(query.mock.calls[2]?.[0]).toContain("status = 'approved'");
  });

  it('does not consume unknown or expired approvals', async () => {
    const store = createConfirmationStore(fakePool([{}]).pool);
    await expect(store.resolveConfirmation('B'.repeat(43), ownerObjectId, 'browser', 'approve'))
      .resolves.toBeNull();
    const expired = createConfirmationStore(fakePool([{ status: 'expired' }]).pool);
    await expect(expired.resolveConfirmation('B'.repeat(43), ownerObjectId, 'browser', 'approve'))
      .resolves.toBe('expired');
  });
});
