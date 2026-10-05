import { afterEach, describe, expect, it } from 'vitest';
import type { BackendModule } from '../modules.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from './index.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const agentToken = 'header.agent.signature';
const activities: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(activities.splice(0).map((app) => app.close()));
});

describe('Jarvis tool activity events', () => {
  it.each([
    ['ok', async () => ({ secret: 'private result' })],
    ['refused', async () => { throw new ToolRefusal('private refusal detail'); }],
    ['error', async () => { throw new ToolFailure('private failure detail'); }],
  ] as const)('publishes only the recorded %s outcome', async (outcome, execute) => {
    const recorded: { outcome: string }[] = [];
    const tools: BackendModule = {
      id: 'activity-test',
      tools: [{
        name: 'activity_test',
        description: 'Test an activity outcome.',
        inputSchema: {
          type: 'object',
          properties: { note: { type: 'string' } },
          required: ['note'],
          additionalProperties: false,
        },
        sensitive: true,
        execute,
      }],
      registerRoutes: async () => {},
    };
    const app = buildApp(config, undefined, {
      modules: [coreModule, tools],
      auth: async () => ({
        kind: 'jarvis-agent',
        objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef',
        tenantId: config.auth.tenantId,
      }),
      toolCallStore: { record: async (call) => { recorded.push(call); } },
    });
    activities.push(app);
    const events: unknown[] = [];
    app.jarvisActivityHub.subscribe((event) => events.push(event));

    const response = await app.inject({
      method: 'POST',
      url: '/tools/activity_test',
      headers: {
        authorization: ['Bearer', agentToken].join(' '),
        'x-jarvis-message-id': '101',
      },
      payload: { note: 'private argument' },
    });

    expect(response.statusCode).toBe(200);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.outcome).toBe(outcome);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'tool-call-started',
      source: 'chat',
      toolName: 'activity_test',
    });
    expect(events[1]).toMatchObject({
      type: 'tool-call-finished',
      source: 'chat',
      toolName: 'activity_test',
      outcome,
    });
    expect((events[0] as { activityId: string }).activityId)
      .toBe((events[1] as { activityId: string }).activityId);
    expect(JSON.stringify(events)).not.toMatch(/private|argument|secret|result|transcript/iu);
    expect(events.every((event) => Object.keys(event as object).every((key) =>
      ['type', 'activityId', 'source', 'toolName', 'outcome'].includes(key)))).toBe(true);
  });
});
