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

describe('the result given for a tool that threw something unexpected', () => {
  const socketError = (code: string) => Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error(`write ${code} 10.0.0.5:443 secret-token-value`), { code }),
  });
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const unknownOutcome = 'so it may or may not have gone through. Check before trying again.';

  // The request was, or may have been, delivered before the call ended.
  const afterSend = [
    ['a timeout', timeout, 'It did not finish in time'],
    ['ETIMEDOUT', socketError('ETIMEDOUT'), 'It did not finish in time'],
    ['a headers timeout', socketError('UND_ERR_HEADERS_TIMEOUT'), 'It did not finish in time'],
    ['a body timeout', socketError('UND_ERR_BODY_TIMEOUT'), 'It did not finish in time'],
    ['ECONNRESET', socketError('ECONNRESET'), 'The connection dropped before it finished'],
    ['EPIPE', socketError('EPIPE'), 'The connection dropped before it finished'],
    ['a closed socket', socketError('UND_ERR_SOCKET'), 'The connection dropped before it finished'],
    ['an unknown error', new Error('select * from secrets'), 'It hit an unexpected problem'],
    ['something that is not an error', 'not an error', 'It hit an unexpected problem'],
  ] as const;
  // The connection was never made, so the request provably never left.
  const neverSent = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'] as const;

  it.each(afterSend)('says a write may or may not have gone through after %s, and never "Not done."', (_name, error, cause) => {
    for (const effect of ['action', 'unclassified', undefined] as const) {
      const { result } = unexpectedToolFailure(error, false, effect);
      expect(result).toEqual({ error: `${cause}, ${unknownOutcome}`, outcomeUnknown: true });
      expect(confirmToolCall('some_tool', 'error', result)).toBe(`${cause}, ${unknownOutcome}`);
    }
  });

  it.each(afterSend)('says plainly that nothing changed for a read-only tool after %s', (_name, error, cause) => {
    const { result } = unexpectedToolFailure(error, false, 'read');
    expect(result).toEqual({ error: `${cause}.` });
    expect(confirmToolCall('some_tool', 'error', result)).toBe(`Not done. ${cause}.`);
  });

  it.each(neverSent)('says only that the request was not sent when %s proves it never left', (code) => {
    const write = unexpectedToolFailure(socketError(code), false, 'action');
    expect(write.result.error).toBe('It could not reach the service it needs, so that request was not sent.');
    expect(confirmToolCall('some_tool', 'error', write.result)).not.toMatch(/^Not done/u);
    const read = unexpectedToolFailure(socketError(code), false, 'read');
    expect(confirmToolCall('some_tool', 'error', read.result)).toBe('Not done. It could not reach the service it needs.');
  });

  it('lets any sign that the request left win over a sign that it did not', () => {
    const mixed = Object.assign(new TypeError('fetch failed'), {
      code: 'ECONNREFUSED', cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    });
    expect(unexpectedToolFailure(mixed, false, 'action').log.failureClass).toBe('dropped');
  });

  it('treats a stop the same way: a write that was stopped may still have gone through', () => {
    expect(unexpectedToolFailure(timeout, true, 'action').result.error).toBe(`It was stopped before it finished, ${unknownOutcome}`);
    expect(unexpectedToolFailure(timeout, true, 'read').result).toEqual({ error: 'It was stopped before it finished.' });
  });

  it('never repeats the error text or code in the result', () => {
    for (const [, error] of afterSend) {
      for (const effect of ['read', 'action', undefined] as const) {
        expect(unexpectedToolFailure(error, false, effect).result.error).not.toMatch(/secret|10\.0\.0\.5|ECONN|UND_ERR|ETIMEDOUT|EPIPE|aborted|select/u);
      }
    }
    for (const code of neverSent) {
      expect(unexpectedToolFailure(socketError(code), false, 'action').result.error).not.toMatch(/secret|10\.0\.0\.5|ECONN|ENOTFOUND|EAI_AGAIN|UND_ERR/u);
    }
  });

  it('logs only the error class (names and codes), never the message', () => {
    const { log } = unexpectedToolFailure(socketError('UND_ERR_SOCKET'), false, 'action');
    expect(log).toEqual({ failureClass: 'dropped', effect: 'action', errorName: 'TypeError', causeName: 'Error', causeCode: 'UND_ERR_SOCKET' });
    expect(JSON.stringify(log)).not.toMatch(/10\.0\.0\.5|fetch failed|secret/u);
    expect(unexpectedToolFailure('not an error', false, undefined).log).toEqual({ failureClass: 'unexpected', effect: 'none' });
    // A name or code that is not a plain token is dropped rather than logged.
    const odd = Object.assign(new Error('x'), { name: 'Bearer secret value', code: 'has spaces' });
    expect(unexpectedToolFailure(odd, false, 'read').log).toEqual({ failureClass: 'unexpected', effect: 'read' });
  });
});
