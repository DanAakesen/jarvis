import { describe, expect, it } from 'vitest';
import { VaultWriteConflictError } from '../../vault/github-client.js';
import { createPiArea } from '../area.js';
import { createMemoryPiStore } from '../store.js';
import { memoryVault } from '../brain/brain.testkit.js';
import { createWatches } from './store.js';

const signal = new AbortController().signal;

function setup(start = '2026-11-16T10:00:00Z') {
  const clock = { t: new Date(start) };
  const now = () => clock.t;
  const vault = memoryVault();
  const store = createMemoryPiStore(now);
  const make = () => createWatches({ area: createPiArea({ vault }), store, now });
  const run = (id = 'r1') => ({ runId: id, sent: [], wrote: [], looked: [] as string[] });
  return { clock, vault, store, watches: make(), make, run, advance: (ms: number) => { clock.t = new Date(clock.t.getTime() + ms); } };
}
const hours = (n: number) => n * 60 * 60_000;

describe('standing watches in the vault', () => {
  it('opens a watch as a note, lists it, and is rebuilt from the vault after a restart', async () => {
    const t = setup();
    const created = await t.watches.create({ title: 'Deploy of main', text: 'Tell me when green.', quote: 'keep me updated', nextLook: new Date(t.clock.t.getTime() + hours(1)) }, signal);
    expect(created.name).toBe('Deploy of main');
    expect(t.vault.files.get('PI/Watches/Deploy of main.md')).toContain('> Dan,');
    const reborn = t.make();
    const listed = await reborn.list(signal);
    expect(listed).toEqual([expect.objectContaining({ name: 'Deploy of main', nextLook: new Date(t.clock.t.getTime() + hours(1)).toISOString(), looksToday: 0, costTodayDkk: 0 })]);
    expect(await reborn.nextDueAt(signal)).toEqual(new Date(t.clock.t.getTime() + hours(1)));
  });

  it('gives a second watch with the same title its own name', async () => {
    const t = setup();
    await t.watches.create({ title: 'Price', text: 'a' }, signal);
    expect((await t.watches.create({ title: 'Price', text: 'b' }, signal)).name).toBe('Price 2');
  });

  it('has no limit on open watches or on how often one is looked at', async () => {
    const t = setup();
    for (let n = 0; n < 12; n += 1) await t.watches.create({ title: `Watch ${n}`, text: 'x' }, signal);
    expect(await t.watches.list(signal)).toHaveLength(12);
    for (let n = 12; n < 55; n += 1) await t.watches.create({ title: `Watch ${n}`, text: 'x' }, signal);
    // A restart reads every note, not only the first fifty.
    expect(await t.make().list(signal)).toHaveLength(55);
    await expect(t.watches.create({ title: 'Bad', text: 'x', nextLook: new Date(Number.NaN) }, signal)).rejects.toMatchObject({ code: 'invalid' });
    await t.watches.create({ title: 'Build', text: 'x', nextLook: new Date(t.clock.t.getTime() + hours(1)) }, signal);
    const run = t.run();
    await t.watches.look({ name: 'Build', result: 'still running', nextLook: new Date(t.clock.t.getTime() + 60_000) }, run, signal);
    expect(run.looked).toEqual(['Build']);
    expect(t.vault.files.get('PI/Watches/Build.md')).toContain('looked: still running');
    for (let n = 0; n < 12; n += 1) await t.watches.look({ name: 'Build', result: `look ${n}`, nextLook: null }, t.run(`r${n}`), signal);
    expect((await t.watches.list(signal)).find(({ name }) => name === 'Build')?.looksToday).toBe(13);
    await expect(t.watches.look({ name: 'Nothing', result: 'x', nextLook: null }, t.run('ry'), signal)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('shows what a watch costs per day and month, splitting a wake over what woke it', async () => {
    const t = setup();
    await t.watches.create({ title: 'A', text: 'x' }, signal);
    await t.watches.create({ title: 'B', text: 'x' }, signal);
    const run = t.run('wake-1');
    await t.watches.look({ name: 'A', result: 'ok', nextLook: null }, run, signal);
    t.advance(1_000);
    await t.watches.look({ name: 'B', result: 'ok', nextLook: null }, run, signal);
    // The wake cost 0.30 DKK and was woken by 1 event and 2 watches: 0.10 each.
    await t.watches.afterRun({ runId: 'wake-1', costDkk: 0.3, events: 1, run, due: [] }, signal);
    const listed = await t.watches.list(signal);
    expect(listed.map(({ name, looksToday, costTodayDkk, costMonthDkk }) => ({ name, looksToday, costTodayDkk, costMonthDkk })))
      .toEqual([{ name: 'A', looksToday: 1, costTodayDkk: 0.1, costMonthDkk: 0.1 }, { name: 'B', looksToday: 1, costTodayDkk: 0.1, costMonthDkk: 0.1 }]);
  });

  it('records the same watch identity only once in a wake', async () => {
    const t = setup();
    await t.watches.create({ title: 'Build', text: 'x' }, signal);
    const run = t.run('wake-duplicate');
    await t.watches.look({ name: 'Build', result: 'still running', nextLook: null }, run, signal);
    await t.watches.look({ name: 'Build', result: 'still running', nextLook: null }, run, signal);
    expect(run.looked).toEqual(['Build']);
    expect((await t.watches.list(signal))[0]).toMatchObject({ looksToday: 1 });
  });

  it('moves a due watch that got no look an hour ahead, so one stuck watch cannot wake the brain again and again', async () => {
    const t = setup();
    await t.watches.create({ title: 'Stuck', text: 'x', nextLook: new Date(t.clock.t.getTime() + hours(1)) }, signal);
    t.advance(hours(1) + 1);
    await t.watches.afterRun({ runId: 'r', costDkk: 0.1, events: 0, run: t.run('r'), due: ['Stuck'] }, signal);
    expect(await t.watches.nextDueAt(signal)).toEqual(new Date(t.clock.t.getTime() + hours(1)));
    expect(t.vault.files.get('PI/Watches/Stuck.md')).toContain('no look was recorded');
  });

  it('does not report a look as recorded when the ledger cannot count it, and changes nothing', async () => {
    const t = setup();
    await t.watches.create({ title: 'Ledger', text: 'x', nextLook: new Date(t.clock.t.getTime() + hours(1)) }, signal);
    const before = t.vault.files.get('PI/Watches/Ledger.md');
    (t.store as { recordLook: unknown }).recordLook = async () => { throw new Error('sql down'); };
    const run = t.run();
    await expect(t.watches.look({ name: 'Ledger', result: 'x', nextLook: null }, run, signal)).rejects.toMatchObject({ code: 'unavailable' });
    expect(run.looked).toEqual([]);
    expect(t.vault.files.get('PI/Watches/Ledger.md')).toBe(before);
  });

  it('tells the waker whenever a watch is opened, rescheduled or stopped', async () => {
    const t = setup();
    let hints = 0;
    const watches = createWatches({ area: createPiArea({ vault: t.vault }), store: t.store, now: () => t.clock.t, changed: () => { hints += 1; } });
    await watches.create({ title: 'Hinted', text: 'x', nextLook: new Date(t.clock.t.getTime() + hours(1)) }, signal);
    await watches.update({ name: 'Hinted', change: 'sooner', nextLook: new Date(t.clock.t.getTime() + 10 * 60_000) }, signal);
    t.advance(60_000);
    await watches.look({ name: 'Hinted', result: 'ok', nextLook: null }, t.run(), signal);
    await watches.stop({ name: 'Hinted', reason: 'done' }, signal);
    expect(hints).toBe(4);
  });

  it('closes a watch into Closed with a trail line and no next look, and lists it no more', async () => {
    const t = setup();
    await t.watches.create({ title: 'Old', text: 'x', nextLook: new Date(t.clock.t.getTime() + hours(1)) }, signal);
    expect(await t.watches.stop({ name: 'Old', reason: 'Dan said stop' }, signal)).toEqual({ closedAs: 'Old' });
    expect(t.vault.files.has('PI/Watches/Old.md')).toBe(false);
    const closed = t.vault.files.get('PI/Watches/Closed/Old.md')!;
    expect(closed).toContain('closed: Dan said stop');
    expect(closed).not.toContain('jarvis-watch');
    expect(await t.make().list(signal)).toEqual([]);
    expect(await t.watches.nextDueAt(signal)).toBeNull();
    await t.watches.create({ title: 'Old', text: 'again' }, signal);
    expect(await t.watches.stop({ name: 'Old', reason: 'again' }, signal)).toEqual({ closedAs: 'Old 2' });
  });

  it('carries what the brain needs: every open watch in brief, and the due ones in full', async () => {
    const t = setup();
    await t.watches.create({ title: 'Due one', text: 'Check the price of the thing.', nextLook: new Date(t.clock.t.getTime() + 10 * 60_000) }, signal);
    await t.watches.create({ title: 'Later', text: 'Weekly.', nextLook: new Date(t.clock.t.getTime() + hours(48)) }, signal);
    t.advance(11 * 60_000);
    const { sections, lines, due } = await t.watches.sections(t.clock.t, signal);
    expect(due).toEqual(['Due one']);
    expect(lines).toEqual(['watch due: Due one']);
    expect(sections[0]).toContain('Open watches (2');
    expect(sections[0]).toContain('Due one [DUE NOW]');
    expect(sections[1]).toContain('Watch due now: Due one');
    expect(sections[1]).toContain('Check the price of the thing.');
    expect(sections).toHaveLength(2);
  });

  it('reports an unreadable vault as unavailable, and reads again when it is back', async () => {
    const t = setup();
    await t.watches.create({ title: 'A', text: 'x' }, signal);
    const reborn = t.make();
    const read = t.vault.read;
    (t.vault as { read: unknown }).read = async () => { throw new Error('down'); };
    await expect(reborn.list(signal)).rejects.toMatchObject({ code: 'unavailable' });
    (t.vault as { read: unknown }).read = read;
    expect(await reborn.list(signal)).toHaveLength(1);
  });

  it('rereads the latest note and preserves a human edit during a watch update', async () => {
    const t = setup();
    await t.watches.create({ title: 'Deploy', text: 'Watch the deploy.', nextLook: new Date(t.clock.t.getTime() + hours(1)) }, signal);
    await t.watches.list(signal);
    const path = 'PI/Watches/Deploy.md';
    t.vault.files.set(path, t.vault.files.get(path)!.replace('Watch the deploy.', 'Watch the deploy and keep my own note.\n\nDan edit: wait for the database.'));
    await t.watches.update({
      name: 'Deploy',
      change: 'check every hour',
      nextLook: new Date(t.clock.t.getTime() + hours(2)),
    }, signal);
    const saved = t.vault.files.get(path)!;
    expect(saved).toContain('Dan edit: wait for the database.');
    expect(saved).toContain('changed: check every hour');
    expect(await t.make().nextDueAt(signal)).toEqual(new Date(t.clock.t.getTime() + hours(2)));
  });

  it('refreshes the in-memory index after notes are added or removed outside PI', async () => {
    const t = setup();
    expect(await t.watches.list(signal)).toEqual([]);
    await t.watches.create({ title: 'First', text: 'x' }, signal);
    const path = 'PI/Watches/First.md';
    t.vault.files.set(path + '.hidden', 'ignored');
    t.vault.files.set('PI/Watches/Dan added.md', '# Dan added\n\nHuman watch\n\n## Trail\n');
    expect((await t.watches.list(signal)).map(({ name }) => name).sort()).toEqual(['Dan added', 'First']);
    t.vault.files.delete(path);
    expect((await t.watches.list(signal)).map(({ name }) => name)).toEqual(['Dan added']);
  });

  it('reports a genuine repeated Vault conflict instead of overwriting the human revision', async () => {
    const t = setup();
    await t.watches.create({ title: 'Contended', text: 'x' }, signal);
    const path = 'PI/Watches/Contended.md';
    const original = t.vault.write;
    let conflicts = 0;
    t.vault.write = async (notePath, content, message, expected, abort) => {
      if (notePath === path && conflicts < 3) {
        conflicts += 1;
        t.vault.files.set(path, `${t.vault.files.get(path)!.trimEnd()}\n\nDan revision ${conflicts}\n`);
        throw new VaultWriteConflictError();
      }
      return original(notePath, content, message, expected, abort);
    };
    await expect(t.watches.update({ name: 'Contended', change: 'new cadence' }, signal))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(t.vault.files.get(path)).toContain('Dan revision 3');
    expect(t.vault.files.get(path)).not.toContain('changed: new cadence');
  });

  it('pairs cached watch content with the SHA read for that exact content snapshot', async () => {
    let reads = 0;
    const area = {
      async list() {
        return [{ path: 'PI/Watches/Changed.md', sha: 'a'.repeat(40) }];
      },
      async read() {
        reads += 1;
        return {
          content: '# Changed\n\nDan wrote this revision.\n\n## Trail\n',
          sha: 'b'.repeat(40),
        };
      },
    } as never;
    const watches = createWatches({
      area,
      store: createMemoryPiStore(() => new Date('2026-11-16T10:00:00Z')),
      now: () => new Date('2026-11-16T10:00:00Z'),
    });
    await watches.list(signal);
    await watches.list(signal);
    expect(reads).toBe(2);
  });

  it('does not label a parsed pre-write snapshot with a human edit that arrives before reread', async () => {
    const t = setup();
    const path = 'PI/Watches/Atomic.md';
    await t.watches.create({ title: 'Atomic', text: 'The original watch.' }, signal);
    const write = t.vault.write;
    t.vault.write = async (notePath, content, message, expected, abort) => {
      const result = await write(notePath, content, message, expected, abort);
      if (notePath === path) {
        t.vault.files.set(path, content.replace('The original watch.', 'Human edit after PI saved.'));
      }
      return result;
    };
    await t.watches.update({ name: 'Atomic', change: 'PI also changed the trail.' }, signal);
    expect((await t.watches.list(signal))[0]?.excerpt).toContain('Human edit after PI saved.');
  });

  it('caches a newly created watch from the exact reread, not from the attempted create content', async () => {
    const t = setup();
    const path = 'PI/Watches/Created.md';
    const write = t.vault.write;
    t.vault.write = async (notePath, content, message, expected, abort) => {
      const result = await write(notePath, content, message, expected, abort);
      if (notePath === path) {
        t.vault.files.set(path, content.replace('Initial text.', 'Human edit immediately after create.'));
      }
      return result;
    };
    await t.watches.create({ title: 'Created', text: 'Initial text.' }, signal);
    expect((await t.watches.list(signal))[0]?.excerpt).toContain('Human edit immediately after create.');
  });
});
