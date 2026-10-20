import { describe, expect, it } from 'vitest';
import { isVisualCapturedAt, isVisualFrameId, isVisualQuestion, parseVisualResult, parseVisualTurnContext, visualResultText } from './visual-context';

describe('visual input evidence', () => {
  it('does not infer image delivery from a capture or a reference', () => {
    expect(parseVisualResult({ frameId: 'opaque', description: 'An image caption.' })).toBeUndefined();
    expect(parseVisualResult(null)).toBeUndefined();
    expect(parseVisualResult({ visualPath: 'image', frameId: 'opaque', frame: 'image-bytes' }))
      .toEqual({ visualPath: 'image' });
  });
  it.each([
    { visualPath: 'video' }, { visualPath: true }, { visualReason: 'image_attached' },
    { visualPath: 'image', visualReason: null }, { visualPath: 'caption', visualReason: 'x'.repeat(65) },
    { visualPath: 'caption', visualReason: 'Unsafe reason text' },
  ])('rejects malformed evidence: %j', value => {
    expect(() => parseVisualResult(value)).toThrow('invalid visual input status');
  });
  it('describes only the reported input path and never repeats an unknown reason as instructions', () => {
    expect(visualResultText({ visualPath: 'image' })).toBe('Image supplied to Jarvis for this turn.');
    expect(visualResultText({ visualPath: 'caption', visualReason: 'image_input_unverified' }))
      .toBe('Caption only - no image supplied to Jarvis for this turn. Model image support has not been verified.');
    expect(visualResultText({ visualPath: 'caption', visualReason: 'daily_limit' }))
      .toContain('per-day image limit was reached');
    expect(visualResultText({ visualPath: 'caption', visualReason: 'budget_exhausted' }))
      .toContain('image budget was reached');
    expect(visualResultText({ visualPath: 'caption', visualReason: 'budget_unavailable' }))
      .toContain('image budget could not be checked');
    expect(visualResultText({ visualPath: 'caption', visualReason: 'unknown_reason' }))
      .toBe('Caption only - no image supplied to Jarvis for this turn.');
  });
  it('distinguishes legacy-agent input being disabled from unverified model image support', () => {
    expect(visualResultText({ visualPath: 'caption', visualReason: 'legacy_agent' }))
      .toBe('Caption only - no image supplied to Jarvis for this turn. Direct image input is not enabled.');
  });
});

describe('deployed visual turn context', () => {
  it('accepts upload-only handles and retains their turn correlation without inventing a caption', () => {
    const context = {
      source: 'camera', capturedAt: '2026-10-11T20:06:00Z', frameId: 'opaque_123',
      question: 'What is this?', turnId: 'turn_123',
    };
    expect(parseVisualTurnContext(context)).toEqual(context);
    expect(() => parseVisualTurnContext({ ...context, frameId: undefined })).toThrow();
    expect(() => parseVisualTurnContext({ ...context, turnId: 'bad/id' })).toThrow();
  });
  it('counts Unicode question characters as code points, matching the deployed API', () => {
    const character = String.fromCodePoint(0x1f44b);
    expect(isVisualQuestion(character.repeat(500))).toBe(true);
    expect(isVisualQuestion(character.repeat(501))).toBe(false);
    expect(parseVisualTurnContext({
      source: 'camera', capturedAt: '2026-10-11T20:06:00Z', description: 'Fixture.', question: character.repeat(500),
    }).question).toBe(character.repeat(500));
  });
  it.each(['a', 'x'.repeat(128), 'Opaque-ID_12'])('preserves a valid opaque frame reference: %s', (value) => {
    expect(isVisualFrameId(value)).toBe(true);
  });
  it.each(['', 'x'.repeat(129), 'a/b', 'a.b', ' a', null, 42])('refuses an invalid frame reference: %j', (value) => {
    expect(isVisualFrameId(value)).toBe(false);
  });
  it.each(['2026-10-11T20:06:00Z', '2026-10-11T20:06:00.123Z'])('accepts a server UTC capture time: %s', (value) => {
    expect(isVisualCapturedAt(value)).toBe(true);
  });
  it.each(['2026-02-31T20:06:00Z', '2026-10-11', '2026-10-11T20:06:00+02:00', null])(
    'refuses a malformed capture time: %j', (value) => { expect(isVisualCapturedAt(value)).toBe(false); },
  );
  it('validates source, exact bounds and strips unrecognised fields instead of forwarding image bytes', () => {
    const context = {
      source: 'camera', capturedAt: '2026-10-11T20:06:00Z', description: 'x'.repeat(5_000),
      question: 'x'.repeat(500), frameId: 'opaque_123',
    };
    expect(parseVisualTurnContext({ ...context, frame: 'image-bytes' })).toEqual(context);
    expect(() => parseVisualTurnContext({ ...context, source: 'unknown' })).toThrow();
    expect(() => parseVisualTurnContext({ ...context, description: 'x'.repeat(5_001) })).toThrow();
    expect(() => parseVisualTurnContext({ ...context, question: 'x'.repeat(501) })).toThrow();
  });
});
