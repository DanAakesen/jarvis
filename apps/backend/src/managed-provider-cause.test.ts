import { describe, expect, it } from 'vitest';
import { sanitizeManagedProviderCause } from './managed-provider-cause.js';
import { ChatAgentError } from './core/chat-agent.js';

describe('managed provider cause', () => {
  it('retains bounded metadata but never a message or other fields', () => {
    expect(sanitizeManagedProviderCause({
      httpStatus: 400, code: 'unsupported_parameter', param: 'input.content',
      exceptionType: 'BadRequestError', message: 'private detail',
    })).toEqual({
      httpStatus: 400, code: 'unsupported_parameter', param: 'input.content',
      exceptionType: 'BadRequestError',
    });
    expect(sanitizeManagedProviderCause({ code: 'a'.repeat(48) })).toEqual({ code: 'a'.repeat(48) });
  });

  it.each(['', 'a'.repeat(49), 'PRIVATE', 'input[0]', 'input\n', 'a-b', 'a b'])(
    'drops unsafe code and parameter %j', value => {
      expect(sanitizeManagedProviderCause({
        httpStatus: 400, code: value, param: value, exceptionType: 'BadRequestError',
      })).toEqual({ httpStatus: 400, exceptionType: 'BadRequestError' });
    },
  );

  it.each([true, 99, 600, '400', 400.5])('drops invalid status %j', httpStatus => {
    expect(sanitizeManagedProviderCause({ httpStatus })).toBeUndefined();
  });

  it('attaches causes only to reviewed managed policy failures', () => {
    expect(new ChatAgentError('managed_session_busy', undefined, { httpStatus: 400 }).providerCause).toBeUndefined();
    expect(new ChatAgentError('managed_policy_turn_failed', undefined, {
      exceptionType: 'RuntimeError', message: 'private detail',
    }).providerCause).toEqual({ exceptionType: 'RuntimeError' });
  });
});
