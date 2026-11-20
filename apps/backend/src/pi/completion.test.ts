import { describe, expect, it } from 'vitest';
import { finishPiTurn, recordPiToolEvidence } from './completion.js';
import { createPiTurnRegistry } from './turns.js';

const open = () => createPiTurnRegistry().open({
  ownerObjectId: 'owner', sessionId: '1', messageId: '2', signal: new AbortController().signal,
});

describe('PI completion evidence', () => {
  it('distinguishes a current empty list from a lookup that did not retrieve evidence', () => {
    const grant = open();
    const finish = () => finishPiTurn(grant, { turn: grant.turn, kind: 'current_data', tool: 'calendar_list_events' });
    expect(finish()).toMatch(/no verified current_data evidence/u);
    recordPiToolEvidence(grant, 'calendar_list_events', {}, { status: 'unavailable' });
    expect(finish()).toBeDefined();
    recordPiToolEvidence(grant, 'calendar_list_events', {}, []);
    expect(finish()).toBeUndefined();
  });

  it('does not count a lookup, a partial write, or a pending confirmation as a receipt', () => {
    const grant = open();
    recordPiToolEvidence(grant, 'calendar_list_events', {}, [{ id: 'existing' }]);
    expect(finishPiTurn(grant, { turn: grant.turn, kind: 'action', tool: 'calendar_list_events' })).toBeDefined();
    const finish = () => finishPiTurn(grant, { turn: grant.turn, kind: 'action', tool: 'calendar_create_event' });
    for (const result of [null, {}, { status: 'partial' }, { status: 'awaiting_confirmation' }]) {
      recordPiToolEvidence(grant, 'calendar_create_event', {}, result);
      expect(finish()).toBeDefined();
    }
    recordPiToolEvidence(grant, 'calendar_create_event', {}, { status: 'completed', items: [{ id: 'created' }] });
    expect(finish()).toBeUndefined();
  });

  it('requires a durable job and waits for active calls to finish', () => {
    const grant = open();
    const jobId = '93b10d4b-8c76-465c-940f-988b48c131a0';
    const finish = () => finishPiTurn(grant, { turn: grant.turn, kind: 'background', tool: 'research' });
    recordPiToolEvidence(grant, 'research', {}, { jobId });
    expect(finish()).toBeDefined();
    recordPiToolEvidence(grant, 'research', {}, { jobId }, { durableJobs: true });
    grant.inFlightToolCalls = 1;
    expect(finish()).toMatch(/Wait/u);
    grant.inFlightToolCalls = 0;
    expect(finish()).toBeUndefined();
    expect(grant.completion).toEqual({ kind: 'background', id: jobId, tool: 'research', lookup: 'get_job' });
  });
});
