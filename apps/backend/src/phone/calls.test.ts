import websocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneSessionStore } from '../database/phone-session-store.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createVoiceRelayModule } from '../voice/relay.js';
import { createPhoneCallModule } from './calls.js';
import { parsePhoneAllowlist } from './caller.js';

const ownerObjectId = '12bcfab7-49ba-4cf7-8be7-780a13911f93';
const resourceAccountObjectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const config = { ...loadConfig({}), logLevel: 'silent' as const };
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    eventType: 'Microsoft.Communication.IncomingCall',
    data: {
      correlationId: 'call-1',
      incomingCallContext: 'signed-call-context',
      caller: { communicationUser: { id: `8:orgid:${ownerObjectId}` } },
      called: { microsoftTeamsUser: { userId: resourceAccountObjectId } },
    },
    ...overrides,
  };
}

async function appFor({
  callerId = ownerObjectId,
  answerCall = vi.fn(async () => ({
    callConnectionProperties: { callConnectionId: 'connection-1' },
    callConnection: { hangUp: vi.fn(async () => {}) },
  })),
}: {
  callerId?: string;
  answerCall?: ReturnType<typeof vi.fn>;
} = {}) {
  const store: PhoneSessionStore = {
    create: vi.fn(async () => ({
      sessionId: '42',
      callId: 'call-1',
      callerId,
      callConnectionId: null,
      status: 'answering',
    })),
    isActive: vi.fn(async () => true),
    activate: vi.fn(async () => true),
    finish: vi.fn(async () => {}),
    active: vi.fn(async () => []),
  };
  const client = {
    answerCall,
    rejectCall: vi.fn(async () => {}),
    getCallConnection: vi.fn(() => ({ hangUp: vi.fn(async () => {}) })),
  };
  const phoneModule = createPhoneCallModule({
    client: client as never,
    store,
    ownerObjectId,
    teamsResourceAccountObjectId: resourceAccountObjectId,
    publicOrigin: 'https://jarvis.example',
    getAllowlist: async () => parsePhoneAllowlist(`{"entraObjectIds":["${ownerObjectId}"]}`),
    getToken: async () => 'foundry-token',
    connect: (_token, _signal) => new websocket('ws://127.0.0.1:1'),
  });
  const app = buildApp(config, undefined, {
    modules: [
      phoneModule,
      createVoiceRelayModule({
        getToken: async () => 'foundry-token',
        registerPhoneMediaRoute: phoneModule.registerMediaRoute,
      }),
    ],
    auth: async () => ({
      kind: 'jarvis-phone-event-grid',
      objectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenantId: config.auth.tenantId,
    }),
  });
  apps.push(app);
  return { app, client, store, answerCall };
}

describe('ACS phone call handling', () => {
  it('completes Event Grid validation without answering a call', async () => {
    const { app, answerCall, store } = await appFor();
    const response = await app.inject({
      method: 'POST',
      url: '/phone/events',
      headers: { authorization: ['Bearer', 'event-grid.token.signature'].join(' ') },
      payload: [{
        id: 'validation',
        eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent',
        data: { validationCode: 'validation-code' },
      }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ validationResponse: 'validation-code' });
    expect(answerCall).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
  });

  it('rejects a caller before creating a session or answering', async () => {
    const { app, client, store, answerCall } = await appFor();
    const response = await app.inject({
      method: 'POST',
      url: '/phone/events',
      headers: { authorization: ['Bearer', 'event-grid.token.signature'].join(' ') },
      payload: [event({
        data: {
          ...event().data,
          caller: { phoneNumber: { value: '+4512345678' } },
        },
      })],
    });

    expect(response.statusCode).toBe(202);
    expect(client.rejectCall).toHaveBeenCalledWith(
      'signed-call-context',
      { callRejectReason: 'forbidden' },
    );
    expect(store.create).not.toHaveBeenCalled();
    expect(answerCall).not.toHaveBeenCalled();
  });

  it('answers only the trusted resource-account call with secure bidirectional PCM streaming', async () => {
    const { app, client, store, answerCall } = await appFor();
    const response = await app.inject({
      method: 'POST',
      url: '/phone/events',
      headers: { authorization: ['Bearer', 'event-grid.token.signature'].join(' ') },
      payload: [event()],
    });

    expect(response.statusCode).toBe(202);
    expect(client.rejectCall).not.toHaveBeenCalled();
    expect(store.create).toHaveBeenCalledWith({
      eventId: 'event-1',
      callId: 'call-1',
      callerId: ownerObjectId,
    });
    expect(answerCall).toHaveBeenCalledOnce();
    expect(answerCall).toHaveBeenCalledWith(
      'signed-call-context',
      expect.stringMatching(/^https:\/\/jarvis\.example\/phone\/callback\?ticket=/u),
      {
        mediaStreamingOptions: {
          transportType: 'websocket',
          transportUrl: expect.stringMatching(/^wss:\/\/jarvis\.example\/phone\/media\?ticket=/u),
          contentType: 'audio',
          audioChannelType: 'mixed',
          startMediaStreaming: true,
          enableBidirectional: true,
          audioFormat: 'pcm24KMono',
        },
      },
    );
    expect(store.activate).toHaveBeenCalledWith('42', 'connection-1');
  });

  it('fails closed on unexpected Event Grid delivery identities', async () => {
    const { app, answerCall, store } = await appFor();
    const response = await app.inject({
      method: 'POST',
      url: '/phone/events',
      payload: [event()],
    });
    expect(response.statusCode).toBe(401);
    expect(answerCall).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
  });
});
