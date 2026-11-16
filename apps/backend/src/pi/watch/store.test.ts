import { describe, expect, it } from 'vitest';
import { createPiArea } from '../area.js';
import { createMemoryPiStore } from '../store.js';
import { memoryVault } from '../brain/brain.testkit.js';
import { MAX_LOOKS_PER_WATCH_PER_DAY, MAX_OPEN_WATCHES, MIN_LOOK_GAP_MS, createWatches } from './store.js';

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

  it('allows at most ten open watches', async () => {
    const t = setup();
    for (let n = 0; n < MAX_OPEN_WATCHES; n += 1) await t.watches.create({ title: `Watch ${n}`, text: 'x' }, signal);
    await expect(t.watches.create({ title: 'One more', text: 'x' }, signal)).rejects.toMatchObject({ code: 'limit' });
    await t.watches.stop({ name: 'Watch 3', reason: 'done' }, signal);
    await expect(t.watches.create({ title: 'One more', text: 'x' }, signal)).resolves.toMatchObject({ name: 'One more' });
  });

  it('refuses a next look that is too soon or too far away', async () => {
    const t = setup();
    await expect(t.watches.create({ title: 'A', text: 'x', nextLook: new Date(t.clock.t.getTime() + 60_000) }, signal)).rejects.toMatchObject({ code: 'invalid' });
    await expect(t.watches.create({ title: 'A', text: 'x', nextLook: new Date(t.clock.t.getTime() + 500 * 24 * hours(1)) }, signal)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('records a look with its next look, keeps the spacing and the daily count, and says which limit was hit', async () => {
    const t = setup();
    await t.watches.create({ title: 'Build', text: 'x', nextLook: new Date(t.clock.t.getTime() + hours(1)) }, signal);
    const run = t.run();
    await t.watches.look({ name: 'Build', result: 'still running', nextLook: new Date(t.clock.t.getTime() + hours(1)) }, run, signal);
    expect(run.looked).toEqual(['Build']);
    expect(t.vault.files.get('PI/Watches/Build.md')).toContain('looked: still running');
    await expect(t.watches.look({ name: 'Build', result: 'again', nextLook: null }, t.run('r2'), signal)).rejects.toThrow('less than 5 minutes');
    expect((await t.watches.nextDueAt(signal))!.getTime()).toBeGreaterThanOrEqual(t.clock.t.getTime() + MIN_LOOK_GAP_MS);
    for (let n = 1; n < MAX_LOOKS_PER_WATCH_PER_DAY; n += 1) {
      t.advance(MIN_LOOK_GAP_MS + 1_000);
      await t.watches.look({ name: 'Build', result: `look ${n}`, nextLook: null }, t.run(`r${n + 2}`), signal);
    }
    t.advance(MIN_LOOK_GAP_MS + 1_000);
    await expect(t.watches.look({ name: 'Build', result: 'ninth', nextLook: null }, t.run('rx'), signal)).rejects.toThrow('8 times today');
    // The limit moved the next look to tomorrow morning, so the watch is not due again today.
    expect((await t.watches.nextDueAt(signal))!.getTime()).toBeGreaterThan(t.clock.t.getTime() + hours(8));
    expect(t.vault.files.get('PI/Watches/Build.md')).toContain('daily look limit reached');
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

  it('moves a due watch that got no look an hour ahead, so one stuck watch cannot wake the brain again and again', async () => {
    const t = setup();
    await t.watches.create({ title: 'Stuck', text: 'x', nextLook: new Date(t.clock.t.getTime() + hours(1)) }, signal);
    t.advance(hours(1) + 1);
    await t.watches.afterRun({ runId: 'r', costDkk: 0.1, events: 0, run: t.run('r'), due: ['Stuck'] }, signal);
    expect(await t.watches.nextDueAt(signal)).toEqual(new Date(t.clock.t.getTime() + hours(1)));
    expect(t.vault.files.get('PI/Watches/Stuck.md')).toContain('no look was recorded');
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
});
