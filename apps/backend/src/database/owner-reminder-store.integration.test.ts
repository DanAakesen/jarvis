import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations } from './migrations.js';
import { createApprovalNotificationStore } from './approval-notification-store.js';
import { createOwnerReminderStore } from './owner-reminder-store.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Database integration tests require an isolated loopback SQL Server test configuration');
}
const database = `jarvis_owner_reminder_${randomUUID().replaceAll('-', '')}`;
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

async function createClaimedReminder(
  owner: string,
  fireAt: Date,
  idempotencyKey = 'a'.repeat(64),
) {
  const store = createOwnerReminderStore(pool, owner);
  const created = await store.create({
    idempotencyKey,
    taskIdentity: 'b'.repeat(64),
    taskTitle: 'Send the final draft',
    fireAt,
    localTime: '11:00',
    anchorDate: null,
    cadence: null,
    untilTaskDone: false,
  }, new Date(fireAt.getTime() - 300_000));
  const [claimed] = await store.claimDue(fireAt, 1, 120_000);
  return { store, schedule: created.schedule, claimed: claimed! };
}

async function register(owner: string, tokenByte: string) {
  const registrations = createApprovalNotificationStore(pool);
  await expect(registrations.upsert(owner, {
    deviceToken: tokenByte.repeat(32),
    showActions: true,
    timeZone: 'Europe/Copenhagen',
  })).resolves.toBe('saved');
  const [registration] = await registrations.list(owner);
  return { registrations, registration: registration!, token: tokenByte.repeat(32) };
}

describe('durable owner reminder outbox', () => {
  it('claims one schedule and queues one APNs row per immutable registration occurrence', async () => {
    const owner = randomUUID();
    const now = new Date('2026-11-20T10:00:00.000Z');
    const { registration } = await register(owner, '10');
    const store = createOwnerReminderStore(pool, owner);
    const { schedule } = await store.create({
      idempotencyKey: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
      taskIdentity: 'c'.repeat(64),
      taskTitle: 'Book the train',
      fireAt: now,
      localTime: '11:00',
      anchorDate: null,
      cadence: null,
      untilTaskDone: false,
    }, new Date(now.getTime() - 300_000));
    const firstClaims = await Promise.all([
      store.claimDue(now, 1, 120_000),
      store.claimDue(now, 1, 120_000),
    ]);
    const claimed = firstClaims.flat();
    expect(claimed).toHaveLength(1);
    const input = {
      scheduleId: schedule.id,
      claimToken: claimed[0]!.claimToken!,
      occurrenceAt: schedule.fireAt,
      itemId: randomUUID(),
      notificationId: `reminder-${'d'.repeat(48)}`,
      now,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
    };
    const queued = await Promise.all([
      store.queueNativeDeliveries(input),
      store.queueNativeDeliveries(input),
    ]);
    expect(queued.map(({ recipientCount }) => recipientCount)).toEqual([1, 1]);
    await register(owner, '11');
    expect((await store.queueNativeDeliveries(input)).recipientCount).toBe(1);
    const snapshots = await pool.request()
      .input('scheduleId', sql.UniqueIdentifier, schedule.id)
      .query<{ recipient_count: number }>(
        'SELECT recipient_count FROM dbo.owner_reminder_delivery_snapshots WHERE reminder_id = @scheduleId;',
      );
    expect(snapshots.recordset).toEqual([{ recipient_count: 1 }]);
    const rows = await pool.request()
      .input('scheduleId', sql.UniqueIdentifier, schedule.id)
      .query<{
        device_reference: string;
        notification_id: string;
        state: string;
      }>(`SELECT LOWER(CONVERT(nvarchar(36), device_reference)) AS device_reference,
          notification_id, state FROM dbo.owner_reminder_deliveries
        WHERE reminder_id = @scheduleId;`);
    expect(rows.recordset).toEqual([{
      device_reference: registration.registrationId,
      notification_id: input.notificationId,
      state: 'pending',
    }]);

    const claimedDeliveries = await Promise.all([
      store.claimNativeDeliveries({
        scheduleId: schedule.id,
        occurrenceAt: schedule.fireAt,
        claimToken: randomUUID(),
        now,
        leaseUntil: new Date(now.getTime() + 20_000),
      }),
      store.claimNativeDeliveries({
        scheduleId: schedule.id,
        occurrenceAt: schedule.fireAt,
        claimToken: randomUUID(),
        now,
        leaseUntil: new Date(now.getTime() + 20_000),
      }),
    ]);
    const delivery = claimedDeliveries.flat();
    expect(delivery).toHaveLength(1);
    expect(delivery[0]).toMatchObject({
      registrationId: registration.registrationId,
      notificationId: input.notificationId,
      attemptCount: 1,
    });
    await expect(store.acceptedNativeDelivery(
      delivery[0]!.id,
      delivery[0]!.claimToken,
      200,
    )).resolves.toBe(true);
    await expect(store.nativeDeliverySummary(
      schedule.id,
      schedule.fireAt,
    )).resolves.toMatchObject({
      evidenceAvailable: true,
      recipientCount: 1,
      acceptedRecipientCount: 1,
      pendingRecipientCount: 0,
      attemptCount: 1,
      providerOutcome: 'provider_accepted',
      providerStatusCode: 200,
    });
    expect(await store.claimNativeDeliveries({
      scheduleId: schedule.id,
      occurrenceAt: schedule.fireAt,
      claimToken: randomUUID(),
      now: new Date(now.getTime() + 1_000),
      leaseUntil: new Date(now.getTime() + 21_000),
    })).toEqual([]);
  });

  it('preserves retry leases and stops exactly after the second transient attempt', async () => {
    const owner = randomUUID();
    const now = new Date('2026-11-20T11:00:00.000Z');
    await register(owner, '20');
    const { store, schedule, claimed } = await createClaimedReminder(
      owner,
      now,
      randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
    );
    const input = {
      scheduleId: schedule.id,
      claimToken: claimed.claimToken!,
      occurrenceAt: schedule.fireAt,
      itemId: randomUUID(),
      notificationId: `reminder-${'e'.repeat(48)}`,
      now,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
    };
    await store.queueNativeDeliveries(input);
    const first = (await store.claimNativeDeliveries({
      scheduleId: schedule.id,
      occurrenceAt: schedule.fireAt,
      claimToken: randomUUID(),
      now,
      leaseUntil: new Date(now.getTime() + 20_000),
    }))[0]!;
    const retryAt = new Date(now.getTime() + 300_000);
    await expect(store.retryNativeDelivery(
      first.id,
      first.claimToken,
      retryAt,
      503,
    )).resolves.toBe(true);
    await expect(store.finishClaim(schedule.id, claimed.claimToken!, {
      state: 'retrying',
      nextAttemptAt: retryAt,
      sendAttempts: 1,
      lastDelivery: 'retrying',
      lastProviderOutcome: 'provider_unavailable',
      lastProviderStatusCode: 503,
      recipientCount: 1,
      acceptedRecipientCount: 0,
    })).resolves.toBe(true);
    expect(await store.earliestFireAt()).toEqual(retryAt);

    const [secondScheduleClaim] = await store.claimDue(retryAt, 1, 120_000);
    const second = (await store.claimNativeDeliveries({
      scheduleId: schedule.id,
      occurrenceAt: schedule.fireAt,
      claimToken: randomUUID(),
      now: retryAt,
      leaseUntil: new Date(retryAt.getTime() + 20_000),
    }))[0]!;
    expect(second.attemptCount).toBe(2);
    await expect(store.failedNativeDelivery(
      second.id,
      second.claimToken,
      'retry_exhausted',
      503,
    )).resolves.toBe(true);
    expect(await store.nativeDeliverySummary(schedule.id, schedule.fireAt)).toMatchObject({
      attemptCount: 2,
      pendingRecipientCount: 0,
      providerOutcome: 'retry_exhausted',
      providerStatusCode: 503,
    });
    await expect(store.finishClaim(schedule.id, secondScheduleClaim!.claimToken!, {
      state: 'failed',
      reason: 'retries_exhausted',
      sendAttempts: 2,
      lastDelivery: 'failed',
      lastProviderOutcome: 'retry_exhausted',
      lastProviderStatusCode: 503,
      recipientCount: 1,
      acceptedRecipientCount: 0,
    })).resolves.toBe(true);
  });

  it('terminalizes invalid and removed registrations with exact safe outcomes', async () => {
    const invalidOwner = randomUUID();
    const invalidTime = new Date('2026-11-20T12:00:00.000Z');
    const invalidRegistration = await register(invalidOwner, '30');
    const invalid = await createClaimedReminder(
      invalidOwner,
      invalidTime,
      randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
    );
    await invalid.store.queueNativeDeliveries({
      scheduleId: invalid.schedule.id,
      claimToken: invalid.claimed.claimToken!,
      occurrenceAt: invalid.schedule.fireAt,
      itemId: randomUUID(),
      notificationId: `reminder-${'f'.repeat(48)}`,
      now: invalidTime,
      expiresAt: new Date(invalidTime.getTime() + 60 * 60_000),
    });
    const invalidDelivery = (await invalid.store.claimNativeDeliveries({
      scheduleId: invalid.schedule.id,
      occurrenceAt: invalid.schedule.fireAt,
      claimToken: randomUUID(),
      now: invalidTime,
      leaseUntil: new Date(invalidTime.getTime() + 20_000),
    }))[0]!;
    await invalidRegistration.registrations.invalidate(invalidOwner, invalidRegistration.token, 410);
    await invalid.store.invalidNativeDelivery(
      invalidDelivery.id,
      invalidDelivery.claimToken,
      410,
    );
    expect(await invalid.store.nativeDeliverySummary(
      invalid.schedule.id,
      invalid.schedule.fireAt,
    )).toMatchObject({
      acceptedRecipientCount: 0,
      pendingRecipientCount: 0,
      providerOutcome: 'apns_invalid_token',
      providerStatusCode: 410,
    });
    expect(await invalidRegistration.registrations.list(invalidOwner)).toEqual([]);

    const removedOwner = randomUUID();
    const removedTime = new Date('2026-11-20T13:00:00.000Z');
    const removedRegistration = await register(removedOwner, '40');
    const removed = await createClaimedReminder(
      removedOwner,
      removedTime,
      randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
    );
    await removed.store.queueNativeDeliveries({
      scheduleId: removed.schedule.id,
      claimToken: removed.claimed.claimToken!,
      occurrenceAt: removed.schedule.fireAt,
      itemId: randomUUID(),
      notificationId: `reminder-${'1'.repeat(48)}`,
      now: removedTime,
      expiresAt: new Date(removedTime.getTime() + 60 * 60_000),
    });
    await pool.request()
      .input('registrationId', sql.UniqueIdentifier, removedRegistration.registration.registrationId)
      .query('DELETE FROM dbo.approval_notification_registrations WHERE registration_id = @registrationId;');
    expect(await removed.store.nativeDeliverySummary(
      removed.schedule.id,
      removed.schedule.fireAt,
    )).toMatchObject({
      providerOutcome: 'registration_removed',
      pendingRecipientCount: 0,
      attemptCount: 0,
    });
  });
  it('lists active reminders soonest first, then the newest terminal reminders within the limit', async () => {
    const owner = randomUUID();
    const store = createOwnerReminderStore(pool, owner);
    const base = new Date('2026-11-22T10:00:00.000Z');
    for (let index = 0; index < 25; index += 1) {
      const fireAt = new Date(base.getTime() + index * 60_000);
      const { schedule } = await store.create({
        idempotencyKey: (index + 1).toString(16).padStart(64, 'a'),
        taskIdentity: 'b'.repeat(64),
        taskTitle: `Terminal ${index}`,
        fireAt,
        localTime: '11:00',
        anchorDate: null,
        cadence: null,
        untilTaskDone: false,
      }, new Date(base.getTime() - 300_000));
      const [claimed] = await store.claimDue(fireAt, 1, 120_000);
      await store.finishClaim(schedule.id, claimed!.claimToken!, {
        state: 'failed',
        reason: 'provider_rejected',
        lastDelivery: 'failed',
      });
    }
    const active = await store.create({
      idempotencyKey: 'f'.repeat(64),
      taskIdentity: 'c'.repeat(64),
      taskTitle: 'Still scheduled',
      fireAt: new Date(base.getTime() + 24 * 3_600_000),
      localTime: '12:00',
      anchorDate: null,
      cadence: null,
      untilTaskDone: false,
    }, base);

    const listed = await store.list(20);
    expect(listed[0]?.id).toBe(active.schedule.id);
    expect(listed.slice(1).map(({ taskTitle }) => taskTitle)).toEqual(
      Array.from({ length: 19 }, (_, index) => `Terminal ${24 - index}`),
    );
  });

  it('refuses rollback while delivery evidence exists and reapplies cleanly after it is retired', async () => {
    const up = await readFile(
      new URL('../../../../db/migrations/0102_owner_reminder_delivery_outbox.sql', import.meta.url),
      'utf8',
    );
    const down = await readFile(
      new URL('../../../../db/migrations/down/0102_owner_reminder_delivery_outbox.sql', import.meta.url),
      'utf8',
    );
    await expect(pool.request().batch(down)).rejects.toThrow(/must be retained before rollback/u);

    await pool.request().batch(`DELETE FROM dbo.owner_reminder_deliveries;
      DELETE FROM dbo.owner_reminder_delivery_snapshots;
      DELETE FROM dbo.owner_reminder_schedules;`);
    await pool.request().batch(down);
    expect((await pool.request().query<{ table_id: number | null }>(
      `SELECT OBJECT_ID(N'dbo.owner_reminder_deliveries', N'U') AS table_id`,
    )).recordset[0]?.table_id).toBeNull();
    await pool.request().batch(up);
    expect((await pool.request().query<{ table_id: number | null }>(
      `SELECT OBJECT_ID(N'dbo.owner_reminder_deliveries', N'U') AS table_id`,
    )).recordset[0]?.table_id).not.toBeNull();
  });
});
