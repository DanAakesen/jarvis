import { describe, expect, it } from 'vitest';
import { taskWriteHelpers } from '../vault/index.js';
import {
  InboxError, appendTrail, blobSha, closedPathFor, composeNote, inboxPath, isClosedInboxPath, isLiveInboxPath,
  noteExcerpt, noteId, noteTitle, pathItemId, withId,
} from './note.js';

const at = new Date('2026-11-14T21:41:00Z');
const id = '3f2a9c1e';

describe('inbox note format', () => {
  it('writes a free-text note with the verbatim quote and the hidden id last', () => {
    const content = composeNote({
      title: 'Padel night before Christmas',
      note: 'What: a team evening.\nOpen: no date.',
      quote: 'we should do a padel night,\nmaybe before Christmas?',
      source: 'voice',
    }, id, at);
    expect(content).toBe([
      '# Padel night before Christmas',
      '',
      '> Dan, 14 Nov 22:41, voice: "we should do a padel night,',
      '> maybe before Christmas?"',
      '',
      'What: a team evening.',
      'Open: no date.',
      '',
      `<!-- jarvis-inbox:${id} -->`,
      '',
    ].join('\n'));
    expect(noteId(content)).toBe(id);
    expect(noteTitle(content, 'Inbox/x.md')).toBe('Padel night before Christmas');
  });

  it('refuses secrets, empty notes and oversized text', () => {
    expect(() => composeNote({ title: 'Keys', note: 'password: hunter2hunter2' }, id, at)).toThrow(InboxError);
    expect(() => composeNote({ title: 'Empty' }, id, at)).toThrow(/note or the original words/u);
    expect(() => composeNote({ title: 'Big', note: 'x'.repeat(8 * 1024 + 1) }, id, at)).toThrow(/longer than/u);
    expect(() => composeNote({ title: 'Big', quote: 'x'.repeat(16 * 1024 + 1) }, id, at)).toThrow(/longer than/u);
    expect(() => composeNote({ title: '   ', note: 'text' }, id, at)).toThrow(/title/u);
  });

  it('never lets a caller plant or keep a hidden id', () => {
    const content = composeNote({ title: 'Idea <!-- jarvis-inbox:deadbeef -->', note: 'a\n<!-- jarvis-inbox:cafebabe -->\nb' }, id, at);
    expect(noteId(content)).toBe(id);
    expect(content.match(/jarvis-inbox/gu)).toHaveLength(1);
    expect(content).not.toContain('deadbeef');
  });

  it('builds safe, bounded file names inside Inbox/', () => {
    expect(inboxPath('2026-11-14', 'Padel: night / team [x] #1?')).toBe('Inbox/2026-11-14 Padel night team x 1.md');
    expect(inboxPath('2026-11-14', 'Same', 2)).toBe('Inbox/2026-11-14 Same 2.md');
    expect(inboxPath('2026-11-14', '../../etc/passwd')).toBe('Inbox/2026-11-14 etc passwd.md');
    expect(inboxPath('2026-11-14', '.hidden')).toBe('Inbox/2026-11-14 hidden.md');
    expect(inboxPath('2026-11-14', 'é'.repeat(110)).length).toBeLessThanOrEqual(100);
    for (const path of ['Inbox/../Personal/a.md', 'Inbox/Closed/a.md/x.md', 'Personal/Task inbox.md', 'Inbox/.a.md', 'Inbox/a.txt', 'Inbox/a#b.md']) {
      expect(isLiveInboxPath(path)).toBe(false);
    }
    expect(isLiveInboxPath('Inbox/Closed/a.md')).toBe(false);
    expect(isClosedInboxPath('Inbox/Closed/2026-11-14 a.md')).toBe(true);
    expect(() => inboxPath('14-11-2026', 'a')).toThrow(InboxError);
  });

  it('stays outside the task scope so checkboxes in an idea never become tasks', () => {
    expect(taskWriteHelpers.inTaskScope('Inbox/2026-11-14 Idea.md')).toBe(false);
    expect(taskWriteHelpers.inTaskScope('Inbox/Closed/2026-11-14 Idea.md')).toBe(false);
  });

  it('moves a note to Closed under the same name', () => {
    expect(closedPathFor('Inbox/2026-11-14 Idea.md')).toBe('Inbox/Closed/2026-11-14 Idea.md');
    expect(closedPathFor('Inbox/2026-11-14 Idea.md', 3)).toBe('Inbox/Closed/2026-11-14 Idea 3.md');
    expect(() => closedPathFor('Inbox/Closed/x.md')).toThrow(InboxError);
  });

  it('appends trail lines to an existing or new Trail section and keeps the id last', () => {
    const first = appendTrail(composeNote({ title: 'T', note: 'body' }, id, at), 'nudged about weekends', at, id);
    expect(first).toContain('\n## Trail\n- 14 Nov: nudged about weekends\n\n<!-- jarvis-inbox:3f2a9c1e -->\n');
    const second = appendTrail(first, 'closed: binned', new Date('2026-11-18T10:00:00Z'), id);
    expect(second).toContain('- 14 Nov: nudged about weekends\n- 18 Nov: closed: binned\n');
    expect(second.trimEnd().endsWith(`<!-- jarvis-inbox:${id} -->`)).toBe(true);
    expect(second.match(/## Trail/gu)).toHaveLength(1);
  });

  it('adds an id to a note written by another tool, and derives a stable one meanwhile', () => {
    const foreign = '# From ChatGPT\n\n- [ ] not a task\n';
    expect(noteId(foreign)).toBeUndefined();
    expect(pathItemId('Inbox/a.md')).toMatch(/^[0-9a-f]{8}$/u);
    expect(pathItemId('Inbox/a.md')).toBe(pathItemId('Inbox/a.md'));
    expect(noteId(withId(foreign, id))).toBe(id);
    expect(noteTitle('no heading here', 'Inbox/2026-11-14 Fallback name.md')).toBe('Fallback name');
    expect(noteExcerpt(composeNote({ title: 'T', note: 'first line\nsecond', quote: 'q' }, id, at))).toBe('first line second');
  });

  it('computes the git blob sha', () => {
    expect(blobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});
