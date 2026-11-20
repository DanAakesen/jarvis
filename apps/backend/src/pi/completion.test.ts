import { describe, expect, it } from 'vitest';
import { completionEvidence, completionRequirement } from './completion.js';

describe('PI completion evidence', () => {
  it('distinguishes ordinary conversation from current data, actions and durable work', () => {
    expect(completionRequirement('Hello, how are you?')).toBe('conversation');
    expect(completionRequirement('Tell me a task joke')).toBe('conversation');
    expect(completionRequirement('Write a poem about the weather')).toBe('conversation');
    expect(completionRequirement('What is a GitHub issue?')).toBe('conversation');
    expect(completionRequirement('What is on my calendar today?')).toBe('retrieved');
    expect(completionRequirement('Hvad står der i min kalender i dag?')).toBe('retrieved');
    expect(completionRequirement('Could you create a task?')).toBe('committed');
    expect(completionRequirement('Implement issue 1967 in the background')).toBe('durable_job');
  });

  it('records retrieval only from a successful result and requires receipts for actions', () => {
    expect(completionEvidence({ name: 'calendar_list' }, {}, { events: [] })).toMatchObject({
      kind: 'retrieved',
    });
    expect(completionEvidence({
      name: 'calendar_create',
      execution: { defaultEffect: 'action' },
    }, {}, { created: true, id: 'event-1' })).toMatchObject({ kind: 'committed' });
    expect(completionEvidence({
      name: 'calendar_create',
      execution: { defaultEffect: 'action' },
    }, {}, {})).toBeUndefined();
  });

  it('accepts a durable job handle from an action, never from a read of an old task', () => {
    expect(completionEvidence({
      name: 'create_task',
      execution: { defaultEffect: 'action' },
    }, {}, { task: { id: '77', state: 'Ready' } })).toMatchObject({ kind: 'durable_job' });
    expect(completionEvidence({
      name: 'get_task',
      execution: { defaultEffect: 'read' },
    }, {}, { task: { id: '77', state: 'Done' } })).toMatchObject({ kind: 'retrieved' });
    expect(completionEvidence(
      { name: 'research' },
      { topic: 'Current pricing' },
      { jobId: '00000000-0000-4000-8000-000000000077', message: 'Started.' },
    )).toMatchObject({ kind: 'durable_job' });
  });
});
