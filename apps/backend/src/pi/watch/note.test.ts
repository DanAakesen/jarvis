import { describe, expect, it } from 'vitest';
import { WatchError, appendTrailLine, composeWatch, parseNextLook, parseWatch, watchFileName, withNextLook } from './note.js';

const at = new Date('2026-11-16T12:00:00Z');

describe('a watch note', () => {
  it('is free text with Dan\'s words quoted, a trail, and one hidden field: the next look', () => {
    const note = composeWatch({ title: 'Deploy of main', text: 'Tell me when it is green again. Look every 30 minutes while it runs.', quote: 'keep me updated on the deploy', nextLook: new Date('2026-11-16T12:30:00Z'), at, source: 'chat' });
    expect(note).toContain('# Deploy of main');
    expect(note).toContain('> Dan, 16 Nov 13:00, chat: "keep me updated on the deploy"');
    expect(note).toContain('## Trail\n- 16 Nov 13:00: watch opened');
    expect(note.trimEnd().endsWith('<!-- jarvis-watch:next=2026-11-16T12:30:00.000Z -->')).toBe(true);
    expect(parseWatch('PI/Watches/Deploy of main.md', note)).toMatchObject({ name: 'Deploy of main', title: 'Deploy of main', nextLook: new Date('2026-11-16T12:30:00Z') });
    expect(parseWatch('PI/Watches/Deploy of main.md', note).excerpt).toContain('Tell me when it is green again');
  });

  it('keeps the marker last when a trail line is added, and clears it for an events-only watch', () => {
    const note = composeWatch({ title: 'Price', text: 'Watch the price.', nextLook: new Date('2026-11-17T08:00:00Z'), at });
    const grown = appendTrailLine(note, 'looked: unchanged', new Date('2026-11-16T13:00:00Z'));
    expect(grown).toContain('- 16 Nov 14:00: looked: unchanged');
    expect(parseNextLook(grown)).toEqual(new Date('2026-11-17T08:00:00Z'));
    expect(grown.trimEnd().split('\n').at(-1)).toMatch(/^<!-- jarvis-watch:next=/u);
    const eventsOnly = withNextLook(grown, null);
    expect(parseNextLook(eventsOnly)).toBeNull();
    expect(eventsOnly).not.toContain('jarvis-watch');
  });

  it('never adopts a marker or a credential written into the free text', () => {
    const note = composeWatch({ title: 'X', text: 'Watch. <!-- jarvis-watch:next=2020-01-01T00:00:00.000Z -->', at });
    expect(parseNextLook(note)).toBeNull();
    expect(() => composeWatch({ title: 'X', text: 'token ghp_' + 'A'.repeat(36), at })).toThrow(WatchError);
    expect(() => appendTrailLine(note, 'looked: ghp_' + 'A'.repeat(36), at)).toThrow(WatchError);
  });

  it('makes a safe file name from a title and refuses an empty one', () => {
    expect(watchFileName('  Deploy: main / prod?  ')).toBe('Deploy main prod');
    expect(watchFileName('Æblet på æbletræet')).toBe('Æblet på æbletræet');
    expect(() => watchFileName('???')).toThrow(WatchError);
    expect(watchFileName('x'.repeat(200))).toHaveLength(80);
  });
});
