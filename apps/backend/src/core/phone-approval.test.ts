import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendModule } from '../modules.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from './index.js';

const ownerObjectId = '12bcfab7-49ba-4cf7-8be7-780a13911f93';
const config = { ...loadConfig({}), logLevel: 'silent' as const };
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture(active = true) {
  const order: string[] = [];
  const executePrivate = vi.fn(async () => {
    order.push('private tool');
    return { result: 'private data' };
  });
  const executePublic = vi.fn(async () => {
    order.push('public tool');
    return { result: 'public research' };
  });
  const module: BackendModule = {
    id: 'phone-approval-test',
    registerRoutes: async () => {},
    tools: [
      {
        name: 'read_private_data',
        description: 'Read a private fixture.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: executePrivate,
      },
      {
        name: 'web_research',
        description: 'Research a public topic.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        publicAllowedOnPhone: true,
        execute: executePublic,
      },
    ],
  };
  const requestConfirmation = vi.fn(async () => { order.push('Teams approval'); });
  const app = buildApp(config, undefined, {
    modules: [coreModule, module],
    auth: async () => ({
      kind: 'jarvis-agent',
      objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef',
      tenantId: config.auth.tenantId,
    }),
    conversationStore: {
      getDanMessageIdBySourceItemId: async () => '101',
    } as never,
    toolCallStore: { record: async () => {} },
    phoneSessionStore: {
      isActive: vi.fn(async (sessionId: string, callerId: string) =>
        active && sessionId === '42' && callerId === ownerObjectId),
    } as never,
    teamsNotifications: { requestConfirmation } as never,
  });
  apps.push(app);
  return { app, order, executePrivate, executePublic, requestConfirmation };
}

function toolRequest(tool: string) {
  return {
    method: 'POST' as const,
    url: `/tools/${tool}`,
    headers: {
      authorization: ['Bearer', 'agent.header.signature'].join(' '),
      'x-jarvis-voice-item-id': 'item_phone',
      'x-jarvis-phone-session-id': '42',
    },
    payload: {},
  };
}

describe('phone tool approval', () => {
  it('waits for P7-03 approval before every non-public tool', async () => {
    const { app, order, executePrivate, requestConfirmation } = await fixture();
    const response = await app.inject(toolRequest('read_private_data'));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'ok' });
    expect(order).toEqual(['Teams approval', 'private tool']);
    expect(requestConfirmation).toHaveBeenCalledWith(
      'other',
      'Allow read_private_data for this phone call?',
      expect.any(AbortSignal),
    );
    expect(executePrivate).toHaveBeenCalledOnce();
  });

  it('allows public web research without approval', async () => {
    const { app, order, executePublic, requestConfirmation } = await fixture();
    const response = await app.inject(toolRequest('web_research'));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'ok' });
    expect(order).toEqual(['public tool']);
    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(executePublic).toHaveBeenCalledOnce();
  });

  it('refuses an inactive phone session before executing the tool', async () => {
    const { app, executePrivate, requestConfirmation } = await fixture(false);
    const response = await app.inject(toolRequest('read_private_data'));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'refused' });
    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(executePrivate).not.toHaveBeenCalled();
  });
});
