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
    })).toBe('saved');
    expect(await registrations.upsert(owner, {
      deviceToken: 'cd'.repeat(32), showActions: false, timeZone: 'Europe/Copenhagen',
    })).toBe('saved');

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
    expect(await deliveries.reconciliationComplete(owner, sourceA!.id)).toBe(false);
    expect(await deliveries.claimDue(
      owner, randomUUID(), blockedAt, new Date(blockedAt.getTime() + 20_000), 10,
    )).toEqual([]);
    const staleAt = new Date(Date.now() + 60_000);
    expect(await deliveries.reconciliationComplete(owner, sourceA!.id)).toBe(false);
    expect(await deliveries.claimDue(
      owner, randomUUID(), staleAt, new Date(staleAt.getTime() + 20_000), 10,
    )).toEqual([]);
    const acceptedApproval = claimedApproval.deliveries.find(({ showActions }) => showActions)!;
    const failedApproval = claimedApproval.deliveries.find(({ showActions }) => !showActions)!;
    await deliveries.approvalAccepted(
      owner, confirmationId, acceptedApproval.registrationId, 200,
    );
    await deliveries.approvalAccepted(
      owner, confirmationId, acceptedApproval.registrationId, 200,
    );
    await deliveries.approvalFailed(
      owner, confirmationId, failedApproval.registrationId, 'provider_rejected', 403,
    );
    expect(await deliveries.reconciliationComplete(owner, sourceA!.id)).toBe(true);
    await pool.request()
      .input('confirmationId', sql.Char(43), confirmationId)
      .query(`UPDATE dbo.reply_notification_approval_claims
        SET expires_at = DATEADD(minute, -1, SYSUTCDATETIME())
        WHERE confirmation_id = @confirmationId;`);
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
      owner,
      unrelatedDeliveries[1]!.registrationId,
      unrelatedDeliveries[1]!.id,
      firstLease,
      unrelatedDeliveries[1]!.deviceToken,
      410,
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

  it('terminalizes approval and reply rows before every registration deletion path', async () => {
    const conversations = createConversationStore(pool);
    const registrations = createApprovalNotificationStore(pool);
    const deliveries = createReplyNotificationStore(pool);

    const setup = async (tokenByte: string) => {
      const owner = randomUUID();
      const token = tokenByte.repeat(32);
      const session = await conversations.createSession({
        channel: 'chat', language: 'en', ownerObjectId: owner,
      });
      const source = await conversations.addMessage({
        sessionId: session.id, role: 'dan', text: 'Prepare the exact reply.', model: null,
      });
      expect(await registrations.upsert(owner, {
        deviceToken: token, showActions: true, timeZone: 'Europe/Copenhagen',
      })).toBe('saved');
      const registration = (await registrations.list(owner))[0]!;
      const confirmationId = randomBytes(32).toString('base64url');
      const approval = await deliveries.claimApproval({
        owner,
        confirmationId,
        turnMessageId: source!.id,
        expiresAt: new Date(Date.now() + 300_000),
      });
      expect(approval.deliveries).toHaveLength(1);
      const reply = await conversations.addMessage({
        sessionId: session.id,
        role: 'jarvis',
        text: 'Ready.',
        model: 'pi',
        replyNotification: { ownerObjectId: owner, turnMessageId: source!.id },
      });
      return {
        owner, token, session, source: source!, registration, confirmationId, reply: reply!,
      };
    };

    const assertTerminal = async (
      fixture: Awaited<ReturnType<typeof setup>>,
      approvalState: 'failed' | 'invalid_token',
      approvalResult: string,
      replyState: 'failed' | 'invalid_token',
      replyResult: string,
    ) => {
      const { recordset } = await pool.request()
        .input('confirmationId', sql.Char(43), fixture.confirmationId)
        .input('messageId', sql.BigInt, BigInt(fixture.reply.id))
        .query<{
          approval_state: string;
          approval_result: string;
          approval_registration_id: string | null;
          approval_reference: string;
          reply_state: string;
          reply_result: string;
          reply_registration_id: string | null;
          reply_reference: string;
        }>(`SELECT a.state AS approval_state, a.last_result AS approval_result,
            CONVERT(nvarchar(36), a.registration_id) AS approval_registration_id,
            CONVERT(nvarchar(36), a.device_reference) AS approval_reference,
            d.state AS reply_state, d.last_result AS reply_result,
            CONVERT(nvarchar(36), d.registration_id) AS reply_registration_id,
            CONVERT(nvarchar(36), d.device_reference) AS reply_reference
          FROM dbo.reply_notification_approval_deliveries a
          INNER JOIN dbo.reply_notification_deliveries d
            ON d.device_reference = a.device_reference
          WHERE a.confirmation_id = @confirmationId AND d.message_id = @messageId;`);
      expect(recordset).toHaveLength(1);
      expect(recordset[0]).toMatchObject({
        approval_state: approvalState,
        approval_result: approvalResult,
        approval_registration_id: null,
        reply_state: replyState,
        reply_result: replyResult,
        reply_registration_id: null,
      });
      expect(recordset[0]!.approval_reference.toLowerCase())
        .toBe(fixture.registration.registrationId);
      expect(recordset[0]!.reply_reference.toLowerCase())
        .toBe(fixture.registration.registrationId);
      expect(await registrations.list(fixture.owner)).toEqual([]);
    };

    const expired = await setup('10');
    await pool.request()
      .input('registrationId', sql.UniqueIdentifier, expired.registration.registrationId)
      .query(`UPDATE dbo.approval_notification_registrations
        SET expires_at = DATEADD(minute, -1, SYSUTCDATETIME())
        WHERE registration_id = @registrationId;`);
    const replacementToken = '11'.repeat(32);
    expect(await registrations.upsert(expired.owner, {
      deviceToken: replacementToken, showActions: true, timeZone: 'Europe/Copenhagen',
    })).toBe('saved');
    await registrations.remove(expired.owner, replacementToken);
    await assertTerminal(
      expired, 'failed', 'registration_expired', 'failed', 'registration_expired',
    );

    const workerExpired = await setup('12');
    await pool.request()
      .input('registrationId', sql.UniqueIdentifier, workerExpired.registration.registrationId)
      .query(`UPDATE dbo.approval_notification_registrations
        SET expires_at = DATEADD(minute, -1, SYSUTCDATETIME())
        WHERE registration_id = @registrationId;`);
    const expiredAt = new Date(Date.now() + 1_000);
    expect(await deliveries.claimDue(
      workerExpired.owner, randomUUID(), expiredAt,
      new Date(expiredAt.getTime() + 20_000), 10,
    )).toEqual([]);
    await assertTerminal(
      workerExpired, 'failed', 'registration_expired', 'failed', 'registration_expired',
    );

    const unregistered = await setup('20');
    await registrations.remove(unregistered.owner, unregistered.token);
    await assertTerminal(
      unregistered, 'failed', 'registration_removed', 'failed', 'registration_removed',
    );

    const invalidApproval = await setup('30');
    await deliveries.approvalInvalidToken(
      invalidApproval.owner,
      invalidApproval.confirmationId,
      invalidApproval.registration.registrationId,
      invalidApproval.token,
      410,
    );
    const restartedRegistrations = createApprovalNotificationStore(pool);
    expect(await restartedRegistrations.upsert(invalidApproval.owner, {
      deviceToken: invalidApproval.token,
      showActions: true,
      timeZone: 'Europe/Copenhagen',
    })).toBe('invalid_token');
    const genuinelyNewToken = '31'.repeat(32);
    expect(await restartedRegistrations.upsert(invalidApproval.owner, {
      deviceToken: genuinelyNewToken,
      showActions: true,
      timeZone: 'Europe/Copenhagen',
    })).toBe('saved');
    await restartedRegistrations.remove(invalidApproval.owner, genuinelyNewToken);
    await assertTerminal(
      invalidApproval,
      'invalid_token', 'apns_invalid_token',
      'invalid_token', 'apns_invalid_token',
    );
    expect((await pool.request()
      .input('owner', sql.UniqueIdentifier, invalidApproval.owner)
      .query<{ reason: string }>(`SELECT reason
        FROM dbo.approval_notification_token_tombstones
        WHERE owner_object_id = @owner`)).recordset).toEqual([
      { reason: 'apns_invalid_token' },
    ]);
    const staleRegistrationId = randomUUID();
    await pool.request()
      .input('registrationId', sql.UniqueIdentifier, staleRegistrationId)
      .input('owner', sql.UniqueIdentifier, invalidApproval.owner)
      .input('token', sql.VarChar(512), invalidApproval.token)
      .query(`INSERT dbo.approval_notification_registrations
          (registration_id, owner_object_id, device_token, language, show_actions, time_zone, expires_at)
        VALUES (
          @registrationId, @owner, @token, 'en', 1, 'Europe/Copenhagen',
          DATEADD(day, 30, SYSUTCDATETIME())
        );`);
    expect(await restartedRegistrations.list(invalidApproval.owner)).toEqual([]);
    const tombstonedSource = await conversations.addMessage({
      sessionId: invalidApproval.session.id,
      role: 'dan',
      text: 'A stale replacement must not receive delivery.',
      model: null,
    });
    const tombstonedClaim = await deliveries.claimApproval({
      owner: invalidApproval.owner,
      confirmationId: randomBytes(32).toString('base64url'),
      turnMessageId: tombstonedSource!.id,
      expiresAt: new Date(Date.now() + 300_000),
    });
    expect(tombstonedClaim.deliveries).toEqual([]);
    const tombstonedReply = await conversations.addMessage({
      sessionId: invalidApproval.session.id,
      role: 'jarvis',
      text: 'No stale device receives this.',
      model: 'pi',
      replyNotification: {
        ownerObjectId: invalidApproval.owner,
        turnMessageId: tombstonedSource!.id,
      },
    });
    expect((await pool.request()
      .input('messageId', sql.BigInt, BigInt(tombstonedReply!.id))
      .query<{ count: number }>(
        'SELECT COUNT(*) AS count FROM dbo.reply_notification_deliveries WHERE message_id = @messageId',
      )).recordset[0]?.count).toBe(0);
    await pool.request()
      .input('registrationId', sql.UniqueIdentifier, staleRegistrationId)
      .query('DELETE FROM dbo.approval_notification_registrations WHERE registration_id = @registrationId;');

    const proactiveInvalid = await setup('60');
    await registrations.invalidate(proactiveInvalid.owner, proactiveInvalid.token);
    await assertTerminal(
      proactiveInvalid,
      'invalid_token', 'apns_invalid_token',
      'invalid_token', 'apns_invalid_token',
    );
    expect(await createApprovalNotificationStore(pool).upsert(proactiveInvalid.owner, {
      deviceToken: proactiveInvalid.token,
      showActions: true,
      timeZone: 'Europe/Copenhagen',
    })).toBe('invalid_token');

    const raced = await setup('70');
    await registrations.remove(raced.owner, raced.token);
    await assertTerminal(
      raced, 'failed', 'registration_removed', 'failed', 'registration_removed',
    );
    expect(await registrations.upsert(raced.owner, {
      deviceToken: raced.token,
      showActions: true,
      timeZone: 'Europe/Copenhagen',
    })).toBe('saved');
    const replacement = (await registrations.list(raced.owner))[0]!;
    expect(replacement.registrationId).not.toBe(raced.registration.registrationId);
    const replacementSource = await conversations.addMessage({
      sessionId: raced.session.id,
      role: 'dan',
      text: 'A replacement registration turn.',
      model: null,
    });
    const replacementConfirmation = randomBytes(32).toString('base64url');
    const replacementClaim = await deliveries.claimApproval({
      owner: raced.owner,
      confirmationId: replacementConfirmation,
      turnMessageId: replacementSource!.id,
      expiresAt: new Date(Date.now() + 300_000),
    });
    expect(replacementClaim.deliveries.map(({ registrationId }) => registrationId))
      .toEqual([replacement.registrationId]);
    const replacementReply = await conversations.addMessage({
      sessionId: raced.session.id,
      role: 'jarvis',
      text: 'Replacement reply.',
      model: 'pi',
      replyNotification: {
        ownerObjectId: raced.owner,
        turnMessageId: replacementSource!.id,
      },
    });
    const lock = new sql.Transaction(pool);
    await lock.begin();
    let racingUpsert: ReturnType<typeof registrations.upsert> | undefined;
    let racingInvalidation: ReturnType<typeof deliveries.approvalInvalidToken> | undefined;
    try {
      const lockRequest = lock.request().input('owner', sql.UniqueIdentifier, raced.owner);
      const lockResult = await lockRequest.query<{ result: number }>(`DECLARE @result int;
        DECLARE @resource nvarchar(255) =
          CONCAT(N'jarvis.approval-notifications:', CONVERT(nvarchar(36), @owner));
        EXEC @result = sys.sp_getapplock
          @Resource=@resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=5000;
        SELECT @result AS result;`);
      expect(lockResult.recordset[0]?.result).toBeGreaterThanOrEqual(0);
      racingUpsert = registrations.upsert(raced.owner, {
        deviceToken: raced.token,
        showActions: true,
        timeZone: 'Europe/Copenhagen',
      });
      racingInvalidation = deliveries.approvalInvalidToken(
        raced.owner,
        replacementConfirmation,
        raced.registration.registrationId,
        raced.token,
        410,
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      await lock.commit();
    }
    expect(racingUpsert).toBeDefined();
    expect(racingInvalidation).toBeDefined();
    const [racingOutcome] = await Promise.all([racingUpsert!, racingInvalidation!]);
    expect(['saved', 'invalid_token']).toContain(racingOutcome);
    await assertTerminal(
      {
        ...raced,
        registration: replacement,
        source: replacementSource!,
        confirmationId: replacementConfirmation,
        reply: replacementReply!,
      },
      'invalid_token', 'apns_invalid_token',
      'invalid_token', 'apns_invalid_token',
    );
    expect(await createApprovalNotificationStore(pool).upsert(raced.owner, {
      deviceToken: raced.token,
      showActions: true,
      timeZone: 'Europe/Copenhagen',
    })).toBe('invalid_token');

    const invalidReply = await setup('50');
    await deliveries.approvalFailed(
      invalidReply.owner,
      invalidReply.confirmationId,
      invalidReply.registration.registrationId,
      'provider_rejected',
      403,
    );
    const replyLease = randomUUID();
    const replyAt = new Date(Date.now() + 1_000);
    const [claimedReply] = await deliveries.claimDue(
      invalidReply.owner, replyLease, replyAt, new Date(replyAt.getTime() + 20_000), 10,
    );
    await deliveries.invalidateRegistration(
      invalidReply.owner,
      invalidReply.registration.registrationId,
      claimedReply!.id,
      replyLease,
      invalidReply.token,
      410,
    );
    await assertTerminal(
      invalidReply,
      'failed', 'provider_rejected',
      'invalid_token', 'apns_invalid_token',
    );

    const directDelete = await setup('40');
    await pool.request()
      .input('registrationId', sql.UniqueIdentifier, directDelete.registration.registrationId)
      .query('DELETE FROM dbo.approval_notification_registrations WHERE registration_id = @registrationId;');
    await assertTerminal(
      directDelete, 'failed', 'registration_removed', 'failed', 'registration_removed',
    );
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
    const terminalSchema = await readFile(
      new URL('../../../../db/migrations/0095_notification_registration_terminalization.sql', import.meta.url),
      'utf8',
    );
    const terminalDown = await readFile(
      new URL('../../../../db/migrations/down/0095_notification_registration_terminalization.sql', import.meta.url),
      'utf8',
    );
    const tombstoneSchema = await readFile(
      new URL('../../../../db/migrations/0096_apns_device_token_tombstones.sql', import.meta.url),
      'utf8',
    );
    const tombstoneDown = await readFile(
      new URL('../../../../db/migrations/down/0096_apns_device_token_tombstones.sql', import.meta.url),
      'utf8',
    );
    const before = await pool.request().query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM dbo.reply_notification_deliveries',
    );

    await pool.request().batch(tombstoneDown);
    expect((await pool.request().query<{ table_id: number | null }>(
      `SELECT OBJECT_ID(N'dbo.approval_notification_token_tombstones', N'U') AS table_id`,
    )).recordset[0]?.table_id).toBeNull();
    await pool.request().batch(tombstoneSchema);
    await pool.request().batch(terminalDown);
    await pool.request().batch(down);
    expect((await pool.request().query<{ table_id: number | null }>(
      `SELECT OBJECT_ID(N'dbo.reply_notification_approval_deliveries', N'U') AS table_id`,
    )).recordset[0]?.table_id).toBeNull();
    await pool.request().batch(schema);
    await pool.request().batch(terminalSchema);

    const after = await pool.request().query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM dbo.reply_notification_deliveries',
    );
    expect(after.recordset[0]?.count).toBe(before.recordset[0]?.count);
    expect((await pool.request().query<{ table_id: number | null }>(
      `SELECT OBJECT_ID(N'dbo.reply_notification_approval_deliveries', N'U') AS table_id`,
    )).recordset[0]?.table_id).not.toBeNull();

    await pool.request().batch(terminalDown);
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
    await pool.request().batch(terminalSchema);
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
