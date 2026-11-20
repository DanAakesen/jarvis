import { randomBytes, randomUUID } from 'node:crypto';
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
    expect((await Promise.all([
      deliveries.claimApproval(approvalClaim),
      deliveries.claimApproval(approvalClaim),
    ])).sort()).toEqual([false, true]);

    const approvedTurnReply = await conversations.addMessage({
      sessionId: session.id,
      role: 'jarvis',
      text: 'I staged the first change.',
      model: 'pi',
      replyNotification: { ownerObjectId: owner, turnMessageId: sourceA!.id },
    });
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
    expect(approvedTurnReply).not.toBeNull();
    expect(unrelatedTurnReply).not.toBeNull();

    const rows = await pool.request()
      .input('messageA', sql.BigInt, BigInt(approvedTurnReply!.id))
      .input('messageB', sql.BigInt, BigInt(unrelatedTurnReply!.id))
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
        WHERE message_id IN (@messageA, @messageB)
        ORDER BY preview;`);
    expect(rows.recordset).toHaveLength(2);
    expect(rows.recordset.every((row) =>
      row.message_id === unrelatedTurnReply!.id &&
      row.session_id === session.id &&
      row.notification_id === `reply-${unrelatedTurnReply!.id}` &&
      row.state === 'pending')).toBe(true);
    expect(rows.recordset.map(({ preview }) => preview).sort()).toEqual([
      'Design review moved to 10:30.',
      'New reply from Jarvis',
    ]);
    expect(rows.recordset.every(({ evidence_json }) =>
      JSON.parse(evidence_json!)?.category === 'work')).toBe(true);

    const now = new Date(Date.now() + 1_000);
    const firstLease = randomUUID();
    const claimed = await deliveries.claimDue(
      owner, firstLease, now, new Date(now.getTime() + 20_000), 10,
    );
    expect(claimed).toHaveLength(2);
    expect(claimed.map(({ notificationId }) => notificationId))
      .toEqual([`reply-${unrelatedTurnReply!.id}`, `reply-${unrelatedTurnReply!.id}`]);

    await deliveries.accepted(claimed[0]!.id, firstLease, 200);
    await deliveries.invalidateRegistration(
      owner, claimed[1]!.registrationId, claimed[1]!.id, firstLease, 410,
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
      accepted: 1,
      failed: 0,
      expired: 0,
      invalidToken: 1,
    });
    const storedRegistrations = await registrations.list(owner);
    expect(storedRegistrations).toHaveLength(1);
  });
});
