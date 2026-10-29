import { describe, expect, it } from 'vitest';
import { assertRuntimeTestSelection, parseRuntimeTest, validateNativeConversationId,
  validateRuntimeSessionId, validateRuntimeSessionOwner } from './runtime-session.js';

describe('runtime session contract', () => {
  it('keeps normal sessions unselected and accepts explicit test choices', () => {
    expect(parseRuntimeTest(undefined)).toBeUndefined();
    expect(parseRuntimeTest('current')).toBe('current');
    expect(parseRuntimeTest('copilot')).toBe('copilot');
    expect(() => assertRuntimeTestSelection(undefined, undefined)).not.toThrow();
  });
  it.each([null, '', 'other', {}, false])('rejects unknown selection %j', (value) => {
    expect(() => parseRuntimeTest(value)).toThrow(TypeError);
  });
  it('cannot switch normal or existing test sessions', () => {
    expect(() => assertRuntimeTestSelection(undefined, 'copilot')).toThrow('immutable');
    expect(() => assertRuntimeTestSelection('current', 'copilot')).toThrow('immutable');
    expect(() => assertRuntimeTestSelection('copilot', 'current')).toThrow('immutable');
    expect(() => assertRuntimeTestSelection('copilot', 'copilot')).not.toThrow();
    expect(() => assertRuntimeTestSelection('copilot', undefined)).not.toThrow();
  });
  it('bounds SQL identifiers and preserves opaque native references', () => {
    expect(() => validateRuntimeSessionOwner('11111111-2222-3333-4444-555555555555')).not.toThrow();
    expect(() => validateRuntimeSessionOwner('caller')).toThrow();
    for (const value of ['0', '-1', '1;DROP', '9223372036854775808']) expect(() => validateRuntimeSessionId(value)).toThrow();
    expect(() => validateRuntimeSessionId('9223372036854775807')).not.toThrow();
    expect(() => validateNativeConversationId('opaque:reference/ABC ')).not.toThrow();
    for (const value of ['', 'x'.repeat(513), 'x\n']) expect(() => validateNativeConversationId(value)).toThrow();
  });
});
