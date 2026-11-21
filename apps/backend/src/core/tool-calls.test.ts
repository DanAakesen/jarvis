import { describe, expect, it } from 'vitest';
import { confirmToolCall, unexpectedToolFailure } from './tool-calls.js';

describe('the confirmation of a failed or refused tool call', () => {
  it("relays the tool's own plain cause and does not name the tool", () => {
    const cause = 'The weather provider did not answer in time at the forecast step after 2 tries.';
    expect(confirmToolCall('weather', 'error', { error: cause })).toBe(`Not done. ${cause}`);
    expect(confirmToolCall('weather', 'error', { failure: cause })).toBe(`Not done. ${cause}`);
    expect(confirmToolCall('az_group_list', 'error', {})).toBe("Not done. It didn't work, and no reason came back.");
  });

  it('relays the reason a tool declined, or says it was refused', () => {
    expect(confirmToolCall('mail_send', 'refused', { refused: 'That address is not in the allowed list.' }))
      .toBe('Not done. That address is not in the allowed list.');
    expect(confirmToolCall('weather', 'refused', {})).toBe('Not done. It was refused.');
  });

  it('is unchanged for a successful call', () => {
    expect(confirmToolCall('weather', 'ok', {})).toBe('Done: weather succeeded.');
  });
});

describe('the cause given for a tool that threw something unexpected', () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const refused = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:443'), { code: 'ECONNREFUSED' }) });

  it('names a timeout, a network problem or an unknown problem, and a stop', () => {
    expect(unexpectedToolFailure(timeout, false)).toBe('It did not finish in time.');
    expect(unexpectedToolFailure(refused, false)).toBe('It could not reach the service it needs.');
    expect(unexpectedToolFailure(new Error('select * from secrets'), false)).toBe('It hit an unexpected problem.');
    expect(unexpectedToolFailure('not an error', false)).toBe('It hit an unexpected problem.');
    expect(unexpectedToolFailure(timeout, true)).toBe('It was stopped before it finished.');
  });

  it('never repeats the error text', () => {
    for (const error of [timeout, refused, new Error('Bearer secret-token-value')]) {
      expect(unexpectedToolFailure(error, false)).not.toMatch(/secret|10\.0\.0\.5|ECONNREFUSED|aborted/u);
    }
  });
});
