import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventHub } from '../core/event-hub.js';
import type { NowFeedEventHub } from '../core/now.js';
import type { TaskEventHub, TaskEventMessage } from '../factory/task-store.js';
import { createVoiceStatusAnnouncer } from './status-updates.js';

const at = '2026-10-04T12:00:00.000Z';

function taskEvent(type: string, payload: unknown = null): TaskEventMessage {
  return {
    id: '1',
    taskId: '42',
    type,
    summary: 'Sensitive task title and full log content',
    payload,
    payloadTruncated: false,
    source: 'backend',
    at,
  };
}

afterEach(() => vi.useRealTimers());

describe('voice status announcements', () => {
  it('supports direct-only delivery without task or Now subscriptions', () => {
    const speak = vi.fn();
    const announcer = createVoiceStatusAnnouncer({ canSpeak: () => true, speak });
    expect(announcer.announce('Downloadet er færdigt.')).toBe(true);
    expect(speak).toHaveBeenCalledExactlyOnceWith('Downloadet er færdigt.');
    announcer.close();
    expect(announcer.announce('Another update.')).toBe(false);
  });

  it('delivers direct announcements synchronously only while open and able to speak', () => {
    const speak = vi.fn();
    let canSpeak = false;
    const announcer = createVoiceStatusAnnouncer({
      taskEvents: createEventHub<TaskEventMessage>(),
      nowEvents: createEventHub(),
      canSpeak: () => canSpeak,
      speak,
    });

    expect(announcer.announce('The download has finished.')).toBe(false);
    expect(speak).not.toHaveBeenCalled();
    canSpeak = true;
    expect(announcer.announce('The download has finished.')).toBe(true);
    expect(speak).toHaveBeenCalledExactlyOnceWith('The download has finished.');
    announcer.close();
    expect(announcer.announce('Another update.')).toBe(false);
    expect(speak).toHaveBeenCalledOnce();
  });

  it('rejects direct announcements during merging and while a status remains pending', () => {
    vi.useFakeTimers();
    const taskEvents: TaskEventHub = createEventHub<TaskEventMessage>();
    const speak = vi.fn();
    let canSpeak = true;
    const announcer = createVoiceStatusAnnouncer({
      taskEvents,
      nowEvents: createEventHub(),
      canSpeak: () => canSpeak,
      speak,
    });

    taskEvents.publish(taskEvent('state_changed', { to: 'Done' }));
    expect(announcer.announce('Vision update.')).toBe(false);
    canSpeak = false;
    vi.advanceTimersByTime(500);
    canSpeak = true;
    expect(announcer.announce('Vision update.')).toBe(false);
    expect(speak).not.toHaveBeenCalled();
    announcer.flush();
    expect(speak).toHaveBeenCalledExactlyOnceWith('Task 42 is done.');
    expect(announcer.announce('Vision update.')).toBe(true);
    expect(speak).toHaveBeenLastCalledWith('Vision update.');
    announcer.close();
  });

  it('merges only selected events and waits until Dan is no longer speaking', () => {
    vi.useFakeTimers();
    const taskEvents: TaskEventHub = createEventHub<TaskEventMessage>();
    const nowEvents: NowFeedEventHub = createEventHub();
    const speak = vi.fn();
    let canSpeak = false;
    const announcer = createVoiceStatusAnnouncer({
      taskEvents,
      nowEvents,
      canSpeak: () => canSpeak,
      speak,
    });

    taskEvents.publish(taskEvent('state_changed', { from: 'Running', to: 'Done' }));
    taskEvents.publish(taskEvent('state_changed', { from: 'Running', to: 'NeedsAttention' }));
    taskEvents.publish(taskEvent('state_changed', { from: 'Ready', to: 'Running' }));
    taskEvents.publish(taskEvent('progress', { to: 'Done' }));
    nowEvents.publish({ type: 'refresh' });
    nowEvents.publish({ type: 'status', kind: 'pull_request_ready' });
    nowEvents.publish({ type: 'status', kind: 'deployment_failed' });

    vi.advanceTimersByTime(500);
    expect(speak).not.toHaveBeenCalled();

    canSpeak = true;
    announcer.flush();
    expect(speak).toHaveBeenCalledOnce();
    expect(speak).toHaveBeenCalledWith(
      'Task 42 is done, Task 42 needs attention, A pull request is ready, and A deployment has failed.',
    );
    expect(speak.mock.calls[0]?.[0]).not.toContain('Sensitive');
    expect(speak.mock.calls[0]?.[0]).not.toContain('log content');

    announcer.close();
    taskEvents.publish(taskEvent('state_changed', { from: 'Running', to: 'Done' }));
    nowEvents.publish({ type: 'status', kind: 'deployment_failed' });
    vi.advanceTimersByTime(500);
    expect(speak).toHaveBeenCalledOnce();
  });

  it('announces that a browser approval is pending during an active voice session', () => {
    vi.useFakeTimers();
    const nowEvents: NowFeedEventHub = createEventHub();
    const speak = vi.fn();
    const announcer = createVoiceStatusAnnouncer({
      nowEvents,
      canSpeak: () => true,
      speak,
    });

    nowEvents.publish({ type: 'status', kind: 'approval_pending' });
    vi.advanceTimersByTime(500);

    expect(speak).toHaveBeenCalledExactlyOnceWith('Approval is pending in Jarvis.');
    announcer.close();
  });

  it('keeps multiple events of the same kind to one short announcement per burst', () => {
    vi.useFakeTimers();
    const taskEvents: TaskEventHub = createEventHub<TaskEventMessage>();
    const nowEvents: NowFeedEventHub = createEventHub();
    const speak = vi.fn();
    const announcer = createVoiceStatusAnnouncer({
      taskEvents,
      nowEvents,
      canSpeak: () => true,
      speak,
    });

    taskEvents.publish(taskEvent('state_changed', { to: 'Done' }));
    taskEvents.publish(taskEvent('state_changed', { to: 'Done' }));
    vi.advanceTimersByTime(500);

    expect(speak).toHaveBeenCalledOnce();
    expect(speak).toHaveBeenCalledWith('Task 42 is done.');
    announcer.close();
  });

  it('speaks task identity, outcome, and a validated pull request link', () => {
    vi.useFakeTimers();
    const taskEvents: TaskEventHub = createEventHub<TaskEventMessage>();
    const speak = vi.fn();
    const announcer = createVoiceStatusAnnouncer({
      taskEvents,
      canSpeak: () => true,
      speak,
      mergeWindowMs: 60_000,
    });

    taskEvents.publish(taskEvent('pull_request_opened', {
      url: 'https://github.com/DanAakesen/jarvis/pull/12',
    }));
    vi.advanceTimersByTime(60_000);

    expect(speak).toHaveBeenCalledExactlyOnceWith(
      'Task 42 opened a pull request (PR: https://github.com/DanAakesen/jarvis/pull/12).',
    );
    announcer.close();
  });

  it('speaks task outcomes in the active conversation language', () => {
    vi.useFakeTimers();
    const taskEvents: TaskEventHub = createEventHub<TaskEventMessage>();
    const speak = vi.fn();
    const announcer = createVoiceStatusAnnouncer({
      taskEvents,
      language: 'da',
      canSpeak: () => true,
      speak,
    });

    taskEvents.publish(taskEvent('state_changed', { from: 'Running', to: 'NeedsAttention' }));
    vi.advanceTimersByTime(500);

    expect(speak).toHaveBeenCalledExactlyOnceWith('Opgave 42 kræver opmærksomhed.');
    announcer.close();
  });
});
