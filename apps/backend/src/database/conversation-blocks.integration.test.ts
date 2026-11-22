import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations } from './migrations.js';
import { createConversationStore } from './conversation-store.js';
import { createApprovalNotificationStore } from './approval-notification-store.js';
import { createReplyNotificationStore } from './reply-notification-store.js';
import { createPiStore } from './pi-store.js';
import { createPiSituationStore } from './pi-situation-store.js';
import { createProactiveStore } from './proactive-store.js';
import { proactiveSettingsRevision } from '../proactive/preferences.js';
import { sourceIds } from '../proactive/types.js';
import { parsePiSituationState } from '../pi/situation.js';
import { finalizeChatBlock } from '../core/chat-blocks.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Database integration tests require an isolated loopback SQL Server test configuration');
}
const database = `jarvis_ci_${randomUUID().replaceAll('-', '')}`;
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

describe('conversation blocks in the message store', () => {
  it.each([false, true])('keeps the saved reply linked to its turn in history (reply push enabled: %s)', async (notify) => {
    const store = createConversationStore(pool);
    const owner = randomUUID();
    const session = await store.createSession({ channel: 'chat', language: 'en', ownerObjectId: owner });
    const request = await store.addMessage({ sessionId: session.id, role: 'dan', text: 'Question', model: null });
    const reply = await store.addMessage({
      sessionId: session.id, role: 'jarvis', text: 'Saved answer', model: 'pi', replyToTurnId: request!.id,
      ...(notify ? { replyNotification: { ownerObjectId: owner, turnMessageId: request!.id } } : {}),
    });
    expect(reply?.replyToTurnId).toBe(request!.id);
    const history = await store.getHistory({ limit: 10, sessionId: session.id });
    expect(history.messages.map(message => message.replyToTurnId)).toEqual([undefined, request!.id]);
  });

  it('stores a proactive message and continuation receipt atomically and idempotently', async () => {
    const store = createConversationStore(pool);
    const owner = randomUUID();
    const session = await store.createSession({ channel: 'chat', language: 'en', ownerObjectId: owner });
    expect(await createApprovalNotificationStore(pool).upsert(owner, {
      deviceToken: 'da'.repeat(32), showActions: false, timeZone: 'Europe/Copenhagen',
    })).toBe('saved');
    const runId = randomUUID();
    const input = {
      sessionId: session.id,
      text: 'I can move the reminder. Shall I?',
      model: 'pi',
      language: 'en' as const,
      ownerObjectId: owner,
      runId,
      textHash: 'a'.repeat(64),
      evidence: [{
        source: 'calendar',
        ref: 'calendar:42',
        identity: 'calendar-event:42',
        label: 'Flight',
        observedAt: '2026-11-16T09:00:00.000Z',
        verifiedAt: '2026-11-16T09:01:00.000Z',
      }],
      followUpIds: ['follow:flight'],
      at: new Date('2026-11-16T10:00:00.000Z'),
      dayStart: new Date('2026-11-15T23:00:00.000Z'),
      maxMessages: 8,
      replyNotification: { ownerObjectId: owner },
    };
    const [first, retry] = await Promise.all([
      store.addProactiveMessage!(input),
      store.addProactiveMessage!(input),
    ]);
    expect([first.status, retry.status].sort()).toEqual(['existing', 'stored']);
    expect(retry.message?.id).toBe(first.message?.id);
    const duplicate = await store.addProactiveMessage!({
      ...input,
      runId: randomUUID(),
    });
    expect(duplicate).toMatchObject({ status: 'duplicate', message: null });
    await expect(store.addProactiveMessage!({
      ...input,
      runId: randomUUID(),
      textHash: 'b'.repeat(64),
      evidence: [{
        ...input.evidence[0]!,
        label: 'x'.repeat(9_000),
      }],
    })).rejects.toThrow();
    const rows = await pool.request()
      .input('owner', sql.UniqueIdentifier, owner)
      .query<{ messages: number; receipts: number }>(`SELECT
        (SELECT COUNT(*) FROM dbo.messages WHERE jarvis_session_id = ${Number(session.id)}
          AND role = N'jarvis' AND text = N'I can move the reminder. Shall I?') AS messages,
        (SELECT COUNT(*) FROM dbo.pi_message WHERE owner_object_id = @owner) AS receipts;`);
    expect(rows.recordset[0]).toEqual({ messages: 1, receipts: 1 });
    const claimAt = new Date(Date.now() + 1_000);
    const deliveries = await createReplyNotificationStore(pool).claimDue(
      owner, randomUUID(), claimAt, new Date(claimAt.getTime() + 20_000),
    );
    expect(deliveries).toMatchObject([{
      messageId: first.message!.id, sessionId: session.id, proactiveText: input.text,
    }]);

    const piStore = createPiStore(pool);
    const signal = new AbortController().signal;
    expect(await piStore.latestProactiveMessage(owner, input.dayStart, signal)).toMatchObject({
      messageId: first.message!.id, sessionId: session.id, evidence: input.evidence, followUpIds: input.followUpIds,
    });
    const stranger = randomUUID();
    expect(await piStore.recordProactiveMessageFeedback(stranger, first.message!.id, 'wrong', claimAt, signal)).toBe(false);
    expect(await piStore.recordProactiveMessageFeedback(owner, first.message!.id, 'useful', claimAt, signal)).toBe(true);
    expect(await piStore.latestProactiveMessageFeedback(owner, signal)).toEqual({
      messageId: first.message!.id, text: input.text, rating: 'useful',
    });
    expect(await piStore.latestProactiveMessageFeedback(stranger, signal)).toBeUndefined();
  });

  it('refuses grant-held situation evidence after its authority generation advances', async () => {
    const owner = randomUUID();
    const proactive = createProactiveStore(pool, owner);
    const situations = createPiSituationStore(pool);
    const conversations = createConversationStore(pool);
    const signal = new AbortController().signal;
    const observedAt = new Date('2026-11-16T09:00:00.000Z');
    const firstVerification = new Date('2026-11-16T10:00:00.000Z');
    const secondVerification = new Date('2026-11-16T10:01:00.000Z');
    const state = (materialHash: string, verifiedAt: Date) => parsePiSituationState({
      version: 1,
      asOf: verifiedAt.toISOString(),
      summary: '',
      summaryRefIds: [],
      sources: sourceIds.map((id) => ({
        id,
        state: id === 'calendar' ? 'fresh' : 'missing',
        observedAt: id === 'calendar' ? observedAt.toISOString() : null,
        verifiedAt: id === 'calendar' ? verifiedAt.toISOString() : undefined,
        expiresAt: null,
        reason: id === 'calendar' ? null : 'not_observed',
        refIds: id === 'calendar' ? ['calendar:flight'] : [],
      })),
      refs: [{
        id: 'calendar:flight',
        source: 'calendar',
        identity: 'calendar-event:flight',
        label: 'Flight',
        observedAt: observedAt.toISOString(),
        expiresAt: null,
        materialHash,
        verifiedAt: verifiedAt.toISOString(),
      }],
      facts: [],
      followUps: [],
    });
    const initial = await situations.initialize(
      owner,
      parsePiSituationState({
        ...state('0'.repeat(64), firstVerification),
        sources: sourceIds.map((id) => ({
          id,
          state: 'missing',
          observedAt: null,
          expiresAt: null,
          reason: 'not_observed',
          refIds: [],
        })),
        refs: [],
      }),
      observedAt,
      signal,
    );
    const policyRevision = proactiveSettingsRevision(await proactive.settings.read());
    const first = await situations.commit({
      owner,
      expectedRevision: initial.revision,
      expectedHash: initial.hash,
      state: state('a'.repeat(64), firstVerification),
      activation: null,
      policyRevision,
      followUpActions: [],
      authoritativeRefs: [{
        ...state('a'.repeat(64), firstVerification).refs[0]!,
        verifiedAt: firstVerification.toISOString(),
        activatedAt: firstVerification.toISOString(),
        invalidatedAt: null,
        staleReason: null,
      }],
      observations: [{
        source: 'calendar',
        state: 'ok',
        reason: null,
        observedAt: observedAt.toISOString(),
        verifiedAt: firstVerification.toISOString(),
      }],
    }, signal);
    const second = await situations.commit({
      owner,
      expectedRevision: first.revision,
      expectedHash: first.hash,
      state: state('b'.repeat(64), secondVerification),
      activation: null,
      policyRevision,
      followUpActions: [],
      authoritativeRefs: [{
        ...state('b'.repeat(64), secondVerification).refs[0]!,
        verifiedAt: secondVerification.toISOString(),
        activatedAt: secondVerification.toISOString(),
        invalidatedAt: null,
        staleReason: null,
      }],
      observations: [{
        source: 'calendar',
        state: 'ok',
        reason: null,
        observedAt: observedAt.toISOString(),
        verifiedAt: secondVerification.toISOString(),
      }],
    }, signal);
    expect(second.state.refs[0]?.materialHash).toBe('b'.repeat(64));
    const session = await conversations.createSession({ channel: 'chat', language: 'en' });
    await expect(conversations.addProactiveMessage!({
      sessionId: session.id,
      text: 'The old flight generation changed.',
      model: 'pi',
      language: 'en',
      ownerObjectId: owner,
      runId: randomUUID(),
      textHash: 'c'.repeat(64),
      evidence: [{
        source: 'calendar',
        ref: 'calendar:flight',
        identity: 'calendar-event:flight',
        label: 'Flight',
        observedAt: observedAt.toISOString(),
        verifiedAt: firstVerification.toISOString(),
        origin: 'situation',
        materialHash: 'a'.repeat(64),
      }],
      followUpIds: [],
      at: secondVerification,
      dayStart: new Date('2026-11-15T23:00:00.000Z'),
      maxMessages: 8,
    })).rejects.toThrow(/generation changed/u);
    const rows = await pool.request()
      .input('owner', sql.UniqueIdentifier, owner)
      .query<{ messages: number; receipts: number }>(`SELECT
        (SELECT COUNT(*) FROM dbo.messages
          WHERE jarvis_session_id = ${Number(session.id)} AND role = N'jarvis') AS messages,
        (SELECT COUNT(*) FROM dbo.pi_message WHERE owner_object_id = @owner) AS receipts;`);
    expect(rows.recordset[0]).toEqual({ messages: 0, receipts: 0 });
  });

  it('keeps each block with its own reply through history reads, in order, unchanged', async () => {
    const store = createConversationStore(pool);
    const session = await store.createSession({ channel: 'chat', language: 'en' });
    const forecast = finalizeChatBlock({
      version: 1, type: 'forecast', title: 'Copenhagen · Fri 20 Nov', source: { label: 'Open-Meteo', issuedAt: '2026-11-16T16:02:00.000Z' },
      summary: 'Mostly cloudy, high 9 °C, low 5 °C.',
      data: { place: 'Copenhagen', date: '2026-11-20', conditions: 'Mostly cloudy', symbol: 'cloudy', highC: 9, lowC: 5 },
    });
    const chart = finalizeChatBlock({
      version: 1, type: 'chart', title: 'Friday by hour', source: { label: 'Open-Meteo' },
      summary: 'Temperature peaks at 9 °C at 14:00.',
      data: { xLabel: 'Time of day', panels: [
        { title: 'Temperature', unit: '°C', kind: 'line', series: [{ name: 'Temperature', points: [{ x: '08:00', y: 6 }, { x: '14:00', y: null }] }] },
        { title: 'Rain probability', unit: '%', kind: 'bar', series: [{ name: 'Rain probability', points: [{ x: '08:00', y: 20 }] }] },
      ] },
    });
    await store.addMessage({ sessionId: session.id, role: 'dan', text: 'Friday in Copenhagen?', model: null });
    const first = await store.addMessage({ sessionId: session.id, role: 'jarvis', text: 'Here is Friday.', model: null, blocks: [forecast] });
    await store.addMessage({ sessionId: session.id, role: 'dan', text: 'Through the day?', model: null });
    const second = await store.addMessage({ sessionId: session.id, role: 'jarvis', text: 'Midday is warmest.', model: null, blocks: [chart] });
    await store.addMessage({ sessionId: session.id, role: 'jarvis', text: 'No block here.', model: null });

    expect(first?.blocks).toEqual([forecast]);
    const history = await store.getHistory({ limit: 50, sessionId: session.id });
    expect(history.messages.map((message) => message.blocks?.map((block) => block.id))).toEqual([
      undefined, [forecast.id], undefined, [chart.id], undefined,
    ]);
    expect(history.messages[3]!.blocks).toEqual([chart]);
    expect(history.messages[1]!.blocks).toEqual(first!.blocks);
    expect(second?.id).toBe(history.messages[3]!.id);
  });

  it('pages across a message ID digit boundary without skipping or repeating a row', async () => {
    const store = createConversationStore(pool);
    const session = await store.createSession({ channel: 'chat', language: 'en' });
    await pool.request()
      .input('sessionId', sql.BigInt, BigInt(session.id))
      .query(`SET IDENTITY_INSERT dbo.messages ON;
        INSERT INTO dbo.messages (id, jarvis_session_id, role, text) VALUES
          (999998, @sessionId, N'dan', N'First question'),
          (999999, @sessionId, N'jarvis', N'First reply'),
          (1000000, @sessionId, N'dan', N'Second question'),
          (1000001, @sessionId, N'jarvis', N'Second reply');
        SET IDENTITY_INSERT dbo.messages OFF;`);

    const latest = await store.getHistory({ limit: 2, sessionId: session.id });
    expect(latest.messages.map(({ id }) => id)).toEqual(['1000000', '1000001']);
    expect(latest.nextCursor).toBe('1000000');
    const earlier = await store.getHistory({ limit: 2, before: latest.nextCursor!, sessionId: session.id });
    expect(earlier.messages.map(({ id }) => id)).toEqual(['999998', '999999']);
    expect(earlier.nextCursor).toBeNull();
  });

  it('refuses blocks on the owner\'s own message, empty lists and broken blocks', async () => {
    const store = createConversationStore(pool);
    const session = await store.createSession({ channel: 'chat', language: 'en' });
    const block = finalizeChatBlock({
      version: 1, type: 'forecast', title: 'x', source: { label: 'y' }, summary: 'z',
      data: { place: 'Copenhagen', date: '2026-11-20', conditions: 'Clear', symbol: 'clear' },
    });
    await expect(store.addMessage({ sessionId: session.id, role: 'dan', text: 'hi', model: null, blocks: [block] })).rejects.toThrow('Invalid message blocks');
    await expect(store.addMessage({ sessionId: session.id, role: 'jarvis', text: 'hi', model: null, blocks: [] })).rejects.toThrow('Invalid message blocks');
    await expect(store.addMessage({ sessionId: session.id, role: 'jarvis', text: 'hi', model: null, blocks: [{ ...block, type: 'html' } as never] })).rejects.toThrow('Invalid message blocks');
  });
});

describe('voice usage finalization in the conversation store', () => {
  it('does not invent minutes for abandoned sessions and retains provider-only duration', async () => {
    const store = createConversationStore(pool);
    const abandoned = await store.createSession({ channel: 'voice', language: 'en' });
    expect(await store.endSession(abandoned.id)).toBe(true);
    expect((await store.getSession(abandoned.id))?.endedAt).not.toBeNull();
    const abandonedUsage = await pool.request()
      .input('sessionId', sql.BigInt, BigInt(abandoned.id))
      .query('SELECT source, metric, quantity FROM dbo.usage WHERE jarvis_session_id = @sessionId;');
    expect(abandonedUsage.recordset).toEqual([]);

    const providerEnded = await store.createSession({ channel: 'voice', language: 'en' });
    expect(await store.endSession(providerEnded.id, {
      providerVoiceSeconds: 15,
      allowWallClockFallback: false,
    })).toBe(true);
    const providerUsage = await pool.request()
      .input('sessionId', sql.BigInt, BigInt(providerEnded.id))
      .query<{ source: string; metric: string; quantity: number }>(
        'SELECT source, metric, quantity FROM dbo.usage WHERE jarvis_session_id = @sessionId;',
      );
    expect(providerUsage.recordset).toEqual([{
      source: 'voice',
      metric: 'minutes',
      quantity: 0.25,
    }]);
  });
});
