import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationStore } from '../core/conversation-store.js';
import { createEventHub } from '../core/event-hub.js';
import type { OwnerInteractionService } from '../core/owner-interactions.js';
import type { TaskStatusNotificationStore } from '../database/task-status-notification-store.js';
import type { TaskEventHub, TaskEventMessage, TaskStore } from './task-store.js';
import { createTaskStatusNotificationHandler } from './task-status-notifications.js';

const pullRequestUrl = 'https://github.com/DanAakesen/jarvis/pull/12';

function event(type: string, payload: unknown): TaskEventMessage {
  return {
    id: '20',
    taskId: '42',
    type,
    summary: null,
    payload,
    payloadTruncated: false,
    source: 'backend',
    at: '2026-10-06T00:00:00.000Z',
  };
}

function fixture(persistedKeys = new Set<string>()) {
  const task = {
    originMessageId: '11',
    events: [{
      id: '19',
      type: 'pull_request_opened',
      summary: null,
      payload: { url: pullRequestUrl },
      payloadTruncated: false,
      source: 'backend',
      at: '2026-10-05T00:00:00.000Z',
    }],
  };
  const tasks = { get: vi.fn(async () => task) } as unknown as Pick<TaskStore, 'get'>;
  const conversations = {
    getMessageSessionId: vi.fn(async () => '5'),
    getSession: vi.fn(async () => ({
      id: '5',
      channel: 'chat' as const,
      language: 'en' as const,
      startedAt: new Date('2026-10-05T00:00:00.000Z'),
      endedAt: null,
    })),
    addMessage: vi.fn(async () => null),
  } as unknown as ConversationStore;
  const notifications: TaskStatusNotificationStore = {
    claim: vi.fn(async (taskId, state) => {
      const key = `${taskId}:${state}`;
      if (persistedKeys.has(key)) return false;
      persistedKeys.add(key);
      return true;
    }),
  };
  const handler = () => createTaskStatusNotificationHandler({
    tasks,
    conversations,
    notifications,
    onError: vi.fn(),
  });
  return { handler, tasks, conversations, notifications, persistedKeys };
}

describe('task status notifications', () => {
  it('posts completion in the originating conversation with its pull request link', async () => {
    const test = fixture();

    await test.handler()(event('state_changed', { from: 'Running', to: 'Done', pullRequestUrl }));

    expect(test.conversations.getMessageSessionId).toHaveBeenCalledWith('11');
    expect(test.conversations.addMessage).toHaveBeenCalledWith({
      sessionId: '5',
      role: 'jarvis',
      text: `Task 42 is done (PR: ${pullRequestUrl}).`,
      model: null,
      language: 'en',
      allowEndedSession: true,
    });
    expect(test.notifications.claim).toHaveBeenCalledWith('42', 'Done');
  });

  it('posts attention and PR-opened updates with task identity and outcome', async () => {
    const test = fixture();
    const notify = test.handler();

    await notify(event('state_changed', { from: 'Running', to: 'NeedsAttention' }));
    await notify(event('pull_request_opened', { url: pullRequestUrl }));

    expect(test.conversations.addMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      text: `Task 42 needs attention (PR: ${pullRequestUrl}).`,
    }));
    expect(test.conversations.addMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      text: `Task 42 opened a pull request (PR: ${pullRequestUrl}).`,
    }));
    expect(test.notifications.claim).toHaveBeenNthCalledWith(1, '42', 'NeedsAttention');
    expect(test.notifications.claim).toHaveBeenNthCalledWith(2, '42', 'pull_request_opened');
  });

  it('still posts into the originating conversation after its voice session has ended', async () => {
    const test = fixture();
    vi.mocked(test.conversations.getSession).mockResolvedValue({
      id: '5',
      channel: 'voice',
      language: 'da',
      startedAt: new Date('2026-10-05T00:00:00.000Z'),
      endedAt: new Date('2026-10-05T00:01:00.000Z'),
    });

    await test.handler()(event('state_changed', { from: 'Running', to: 'Cancelled' }));

    expect(test.conversations.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: '5',
      language: 'da',
      allowEndedSession: true,
    }));
  });

  it('deduplicates the task/state key when the handler is recreated after restart', async () => {
    const persistedKeys = new Set<string>();
    const first = fixture(persistedKeys);
    const second = fixture(persistedKeys);
    const done = event('state_changed', { from: 'Running', to: 'Done', pullRequestUrl });

    await first.handler()(done);
    await second.handler()(done);

    expect(first.conversations.addMessage).toHaveBeenCalledOnce();
    expect(second.conversations.addMessage).not.toHaveBeenCalled();
    expect(second.notifications.claim).toHaveBeenCalledWith('42', 'Done');
  });

  it('routes committed task events from the application event hub', async () => {
    const eventHub: TaskEventHub = createEventHub<TaskEventMessage>();
    let resolveMessage!: (message: unknown) => void;
    const delivered = new Promise<unknown>((resolve) => { resolveMessage = resolve; });
    const conversations = {
      getMessageSessionId: vi.fn(async () => '5'),
      getSession: vi.fn(async () => ({
        id: '5',
        channel: 'chat' as const,
        language: 'en' as const,
        startedAt: new Date('2026-10-05T00:00:00.000Z'),
        endedAt: null,
      })),
      addMessage: vi.fn(async (message: unknown) => { resolveMessage(message); return null; }),
    } as unknown as ConversationStore;
    const app = buildApp({ ...loadConfig({}), logLevel: 'silent' }, undefined, {
      eventHub,
      taskStore: { get: vi.fn(async () => ({
        originMessageId: '11',
        events: [{
          id: '19',
          type: 'pull_request_opened',
          summary: null,
          payload: { url: pullRequestUrl },
          payloadTruncated: false,
          source: 'backend',
          at: '2026-10-05T00:00:00.000Z',
        }],
      })) } as unknown as TaskStore,
      conversationStore: conversations,
      taskStatusNotificationStore: { claim: vi.fn(async () => true) },
    });

    try {
      eventHub.publish(event('state_changed', { from: 'Running', to: 'Cancelled' }));
      await expect(delivered).resolves.toMatchObject({
        sessionId: '5',
        role: 'jarvis',
        text: `Task 42 was cancelled (PR: ${pullRequestUrl}).`,
      });
    } finally {
      await app.close();
    }
  });

  it('keeps Away pull-request and terminal status updates in the app without channel notifications', async () => {
    const eventHub: TaskEventHub = createEventHub<TaskEventMessage>();
    const messages: unknown[] = [];
    const conversations = {
      getMessageSessionId: vi.fn(async () => '5'),
      getSession: vi.fn(async () => ({
        id: '5',
        channel: 'chat' as const,
        language: 'en' as const,
        startedAt: new Date('2026-10-05T00:00:00.000Z'),
        endedAt: null,
      })),
      addMessage: vi.fn(async (message: unknown) => { messages.push(message); return null; }),
    } as unknown as ConversationStore;
    const notify = vi.fn(async () => {});
    const app = buildApp({ ...loadConfig({}), logLevel: 'silent' }, undefined, {
      eventHub,
      taskStore: { get: vi.fn(async () => ({
        originMessageId: '11',
        events: [{
          id: '19',
          type: 'pull_request_opened',
          summary: null,
          payload: { url: pullRequestUrl },
          payloadTruncated: false,
          source: 'backend',
          at: '2026-10-05T00:00:00.000Z',
        }],
      })) } as unknown as TaskStore,
      conversationStore: conversations,
      awayModeStore: {
        read: vi.fn(async () => ({ mode: 'away', source: 'manual', changedAt: null })),
      },
      ownerInteractions: { notify } as unknown as OwnerInteractionService,
      taskStatusNotificationStore: { claim: vi.fn(async () => true) },
    });
    const events = [
      event('pull_request_opened', { url: pullRequestUrl }),
      event('state_changed', { from: 'Running', to: 'Done', pullRequestUrl }),
      event('state_changed', { from: 'Running', to: 'NeedsAttention' }),
      event('state_changed', { from: 'Running', to: 'Cancelled' }),
    ];

    try {
      for (const update of events) eventHub.publish(update);
      await vi.waitFor(() => expect(messages).toHaveLength(4));
      expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: `Task 42 opened a pull request (PR: ${pullRequestUrl}).` }),
        expect.objectContaining({ text: `Task 42 is done (PR: ${pullRequestUrl}).` }),
        expect.objectContaining({ text: `Task 42 needs attention (PR: ${pullRequestUrl}).` }),
        expect.objectContaining({ text: `Task 42 was cancelled (PR: ${pullRequestUrl}).` }),
      ]));
      expect(notify).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
