import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations } from './migrations.js';
import { createConversationStore } from './conversation-store.js';
import { createApprovalNotificationStore } from './approval-notification-store.js';
import { createReplyNotificationStore } from './reply-notification-store.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Database integration tests require an isolated loopback SQL Server test configuration');
}
const database = `jarvis_reply_${randomUUID().replaceAll('-', '')}`;
const administrator = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });

beforeAll(async () => {
  await administrator.connect();
  await administrator.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
  await applyMigrations(pool, await readMigrations());
});

afterAll(async () => {
  await pool.close();
  if (administrator.connected) {
    await administrator.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN
      ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${database}]; END;`);
  }
  await administrator.close();
});

describe('durable reply notification store', () => {
  it('writes exact-turn suppression and one per-device outbox atomically with the assistant message', async () => {
    const owner = randomUUID();
    const conversations = createConversationStore(pool);
    const registrations = createApprovalNotificationStore(pool);
    const deliveries = createReplyNotificationStore(pool);
    const session = await conversations.createSession({
      channel: 'chat', language: 'en', ownerObjectId: owner,
    });
    const sourceA = await conversations.addMessage({
      sessionId: session.id, role: 'dan', text: 'First turn', model: null,
    });
    const sourceB = await conversations.addMessage({
      sessionId: session.id, role: 'dan', text: 'Second turn', model: null,
    });
    expect(sourceA).not.toBeNull();
    expect(sourceB).not.toBeNull();
    expect(await registrations.upsert(owner, {
      deviceToken: 'ab'.repeat(32), showActions: true, timeZone: 'Europe/Copenhagen',
    })).toBe(true);
    expect(await registrations.upsert(owner, {
      deviceToken: 'cd'.repeat(32), showActions: false, timeZone: 'Europe/Copenhagen',
    })).toBe(true);

    const confirmationId = randomBytes(32).toString('base64url');
    const approvalClaim = {
      owner,
      confirmationId,
      turnMessageId: sourceA!.id,
      expiresAt: new Date(Date.now() + 300_000),
    };
    const approvalClaims = await Promise.all([
      deliveries.claimApproval(approvalClaim),
      deliveries.claimApproval(approvalClaim),
    ]);
    expect(approvalClaims.map(({ claimed }) => claimed).sort()).toEqual([false, true]);
    const claimedApproval = approvalClaims.find(({ claimed }) => claimed)!;
    expect(claimedApproval.deliveries).toHaveLength(2);

    const approvedTurnReply = await conversations.addMessage({
      sessionId: session.id,
      role: 'jarvis',
      text: 'I staged the first change.',
      model: 'pi',
      replyNotification: { ownerObjectId: owner, turnMessageId: sourceA!.id },
    });
    expect(approvedTurnReply).not.toBeNull();
    const blockedAt = new Date(Date.now() + 1_000);
    expect(await deliveries.reconciliationComplete(
      owner, sourceA!.id, blockedAt,
    )).toBe(false);
    expect(await deliveries.claimDue(
      owner, randomUUID(), blockedAt, new Date(blockedAt.getTime() + 20_000), 10,
    )).toEqual([]);
    const acceptedApproval = claimedApproval.deliveries.find(({ showActions }) => showActions)!;
    const failedApproval = claimedApproval.deliveries.find(({ showActions }) => !showActions)!;
    await deliveries.approvalAccepted(
      owner, confirmationId, acceptedApproval.registrationId, 200,
    );
    await deliveries.approvalFailed(
      owner, confirmationId, failedApproval.registrationId, 'provider_rejected', 403,
    );
    expect(await deliveries.reconciliationComplete(
      owner, sourceA!.id, new Date(Date.now() + 1_000),
    )).toBe(true);
    const reconciledTurnReply = await conversations.addMessage({
      sessionId: session.id,
      role: 'jarvis',
      text: 'I reconciled the exact turn.',
      model: 'pi',
      replyNotification: { ownerObjectId: owner, turnMessageId: sourceA!.id },
    });
    expect(reconciledTurnReply).not.toBeNull();

    const unrelatedTurnReply = await conversations.addMessage({
      sessionId: session.id,
      role: 'jarvis',
      text: 'Design review moved to 10:30.',
      model: 'pi',
      replyNotification: {
        ownerObjectId: owner,
        turnMessageId: sourceB!.id,
        evidence: { category: 'work', evidenceSources: ['calendar'] },
      },
    });
    expect(unrelatedTurnReply).not.toBeNull();

    const rows = await pool.request()
      .input('messageA', sql.BigInt, BigInt(approvedTurnReply!.id))
      .input('messageB', sql.BigInt, BigInt(unrelatedTurnReply!.id))
      .input('messageC', sql.BigInt, BigInt(reconciledTurnReply!.id))
      .query<{
        message_id: string;
        session_id: string;
        preview: string;
        notification_id: string;
        state: string;
        evidence_json: string | null;
      }>(`SELECT CONVERT(varchar(20), message_id) AS message_id,
          CONVERT(varchar(20), jarvis_session_id) AS session_id,
          preview, notification_id, state, evidence_json
        FROM dbo.reply_notification_deliveries
        WHERE message_id IN (@messageA, @messageB, @messageC)
        ORDER BY preview;`);
    expect(rows.recordset).toHaveLength(6);
    const approvedRows = rows.recordset.filter(({ message_id }) =>
      message_id === approvedTurnReply!.id);
    expect(approvedRows.map(({ state }) => state).sort()).toEqual(['pending', 'suppressed']);
    const reconciledRows = rows.recordset.filter(({ message_id }) =>
      message_id === reconciledTurnReply!.id);
    expect(reconciledRows.map(({ state }) => state).sort()).toEqual(['pending', 'suppressed']);
    const unrelatedRows = rows.recordset.filter(({ message_id }) =>
      message_id === unrelatedTurnReply!.id);
    expect(unrelatedRows).toHaveLength(2);
    expect(unrelatedRows.every((row) =>
      row.session_id === session.id &&
      row.notification_id === `reply-${unrelatedTurnReply!.id}` &&
      row.state === 'pending')).toBe(true);
    expect(unrelatedRows.map(({ preview }) => preview).sort()).toEqual([
      'Design review moved to 10:30.',
      'New reply from Jarvis',
    ]);
    expect(unrelatedRows.every(({ evidence_json }) =>
      JSON.parse(evidence_json!)?.category === 'work')).toBe(true);

    const now = new Date(Date.now() + 1_000);
    const firstLease = randomUUID();
    const claimed = await deliveries.claimDue(
      owner, firstLease, now, new Date(now.getTime() + 20_000), 10,
    );
    expect(claimed).toHaveLength(4);
    expect(claimed.filter(({ messageId }) => messageId === approvedTurnReply!.id)).toHaveLength(1);
    expect(claimed.filter(({ messageId }) => messageId === reconciledTurnReply!.id)).toHaveLength(1);
    expect(claimed.filter(({ messageId }) => messageId === unrelatedTurnReply!.id)).toHaveLength(2);

    const approvedTurnDelivery = claimed.find(({ messageId }) =>
      messageId === approvedTurnReply!.id)!;
    const reconciledTurnDelivery = claimed.find(({ messageId }) =>
      messageId === reconciledTurnReply!.id)!;
    const unrelatedDeliveries = claimed.filter(({ messageId }) =>
      messageId === unrelatedTurnReply!.id);
    await deliveries.accepted(approvedTurnDelivery.id, firstLease, 200);
    await deliveries.accepted(reconciledTurnDelivery.id, firstLease, 200);
    await deliveries.accepted(unrelatedDeliveries[0]!.id, firstLease, 200);
    await deliveries.invalidateRegistration(
      owner, unrelatedDeliveries[1]!.registrationId, unrelatedDeliveries[1]!.id, firstLease, 410,
    );
    const restartedLease = randomUUID();
    expect(await deliveries.claimDue(
      owner, restartedLease, new Date(now.getTime() + 1_000),
      new Date(now.getTime() + 21_000), 10,
    )).toEqual([]);

    const states = await pool.request()
      .input('messageId', sql.BigInt, BigInt(unrelatedTurnReply!.id))
      .query<{ state: string }>(`SELECT state FROM dbo.reply_notification_deliveries
        WHERE message_id = @messageId ORDER BY state;`);
    expect(states.recordset.map(({ state }) => state)).toEqual(['accepted', 'invalid_token']);
    await expect(deliveries.diagnostics(owner)).resolves.toMatchObject({
      pending: 0,
      accepted: 3,
      failed: 0,
      expired: 0,
      invalidToken: 1,
      suppressed: 2,
    });
    const storedRegistrations = await registrations.list(owner);
    expect(storedRegistrations).toHaveLength(1);
  });

  it('reverses and reapplies per-device approval reconciliation without losing reply rows', async () => {
    const initialSchema = await readFile(
      new URL('../../../../db/migrations/0093_reply_notification_outbox.sql', import.meta.url),
      'utf8',
    );
    const initialDown = await readFile(
      new URL('../../../../db/migrations/down/0093_reply_notification_outbox.sql', import.meta.url),
      'utf8',
    );
    const schema = await readFile(
      new URL('../../../../db/migrations/0094_reply_notification_reconciliation.sql', import.meta.url),
      'utf8',
    );
    const down = await readFile(
      new URL('../../../../db/migrations/down/0094_reply_notification_reconciliation.sql', import.meta.url),
      'utf8',
    );
    const before = await pool.request().query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM dbo.reply_notification_deliveries',
    );

    await pool.request().batch(down);
    expect((await pool.request().query<{ table_id: number | null }>(
      `SELECT OBJECT_ID(N'dbo.reply_notification_approval_deliveries', N'U') AS table_id`,
    )).recordset[0]?.table_id).toBeNull();
    await pool.request().batch(schema);

    const after = await pool.request().query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM dbo.reply_notification_deliveries',
    );
    expect(after.recordset[0]?.count).toBe(before.recordset[0]?.count);
    expect((await pool.request().query<{ table_id: number | null }>(
      `SELECT OBJECT_ID(N'dbo.reply_notification_approval_deliveries', N'U') AS table_id`,
    )).recordset[0]?.table_id).not.toBeNull();

    await pool.request().batch(down);
    await pool.request().batch(initialDown);
    const legacyOwner = randomUUID();
    await pool.request()
      .input('owner', sql.UniqueIdentifier, legacyOwner)
      .input('token', sql.VarChar(512), 'ef'.repeat(32))
      .query(`INSERT dbo.approval_notification_registrations
          (owner_object_id, device_token, language, show_actions, time_zone, expires_at)
        VALUES (@owner, @token, 'en', 1, 'Europe/Copenhagen', DATEADD(day, 30, SYSUTCDATETIME()));`);
    await pool.request().batch(initialSchema);
    await pool.request().batch(schema);
    const registrations = await pool.request()
      .input('owner', sql.UniqueIdentifier, legacyOwner)
      .query<{ registration_id: string | null }>(
        'SELECT CONVERT(nvarchar(36), registration_id) AS registration_id ' +
          'FROM dbo.approval_notification_registrations WHERE owner_object_id = @owner',
      );
    expect(registrations.recordset).toHaveLength(1);
    expect(registrations.recordset[0]?.registration_id).toMatch(
      /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu,
    );
  });
});
