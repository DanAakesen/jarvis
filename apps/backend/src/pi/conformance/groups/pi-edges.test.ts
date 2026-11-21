import { afterAll, describe, expect, it } from 'vitest';
import { coreModule } from '../../../core/index.js';
import { executeCase, plainEnglishProblems, turnKindFor } from '../callable.testkit.js';
import { sampleArgumentSets } from '../schema.testkit.js';
import type { GroupFactory } from '../types.testkit.js';
import { buildConformanceWorld } from '../world.testkit.js';
import { vaultDown } from './pi-brain.testkit.js';
import { locationDown, situationDown } from './pi-situation.testkit.js';
import { createPiGroup } from './pi.testkit.js';

/**
 * What the group's cases cannot say. The suite reports a tool as `ok` only when every case of it is, and `executeCase` first
 * finds the tool in the kind of turn it is called in. So the calls that must be refused (a stale revision, a made-up reference),
 * a wake-only tool in a chat turn, and the PI tools with a store down are checked here, in a world with only the dispatcher
 * (core) and the PI tools.
 */
let fixtures: ReturnType<typeof createPiGroup>;
const core: GroupFactory = () => ({ id: 'core', covers: ['core'], modules: [coreModule] });
const pi: GroupFactory = (context) => { fixtures = createPiGroup(context); return fixtures.group; };
const world = await buildConformanceWorld({ groups: [core, pi] });
afterAll(async () => { await world.close(); });

const tool = (name: string) => world.app.jarvisTools.get(name)!;
const argumentsFor = (name: string) => sampleArgumentSets(tool(name).inputSchema as Record<string, unknown>)[0]!.arguments;
const firstCase = (name: string) => fixtures.group.cases![name]![0]!;

describe('calls that must be refused or fail in plain English', () => {
  const probes = Object.entries(fixtures.probes).flatMap(([name, list]) => list.map((probe) => [name, probe] as const));
  it.each(probes.map(([name, probe]) => [`${name}: ${probe.label}`, name, probe] as const))('%s', async (_title, name, probe) => {
    const done = await executeCase(world, tool(name), probe.turn ?? turnKindFor(name), probe);
    expect(done.outcome).toBe(probe.expect);
    probe.check?.(done.result);
  });
});

describe('arguments generated from the schema', () => {
  // The suite generates arguments only for tools without explicit cases, and every PI tool has some: keep that check here.
  it.each(Object.keys(fixtures.group.cases!))('%s: the schema accepts them and the tool answers without crashing', async (name) => {
    for (const set of sampleArgumentSets(tool(name).inputSchema as Record<string, unknown>)) {
      const done = await executeCase(world, tool(name), turnKindFor(name), { label: set.label, arguments: set.arguments });
      expect(done.message ?? '', `${name} [${set.label}]`).not.toMatch(/^Invalid arguments:/u);
    }
  });
});

describe('a wake-only tool in a chat turn', () => {
  it.each(['message_dan', 'pi_note', 'inbox_trail', 'watch_look'])('%s is not offered, and the door refuses it even if the model names it', async (name) => {
    const ran = () => world.recorded.filter((entry) => entry.tool === name).length;
    const files = () => [...fixtures.brain.vault.files.keys()].sort();
    const before = { ran: ran(), pushes: fixtures.brain.pushes.length, files: files() };
    const chat = world.client.openTurn();
    try {
      const found = await world.client.find(chat, name);
      expect([...found.tools, ...found.otherMatches].map((entry) => entry.name)).not.toContain(name);
      chat.grant.discovered.add(name);
      const call = await world.client.call(chat, name, argumentsFor(name));
      expect(call.status).toBe(200);
      expect(call.outcome).toBe('refused');
      expect(plainEnglishProblems((call.result as { refused?: string }).refused)).toEqual([]);
    } finally { chat.close(); }
    expect(ran(), 'the tool must not have run').toBe(before.ran);
    expect(fixtures.brain.pushes).toHaveLength(before.pushes);
    expect(files()).toEqual(before.files);
  });
});

describe('a situation tool in a wake turn', () => {
  it.each(['situation_read', 'situation_lookup', 'situation_patch', 'situation_commit'])('%s needs a live PI activation, which a wake does not have', async (name) => {
    const done = await executeCase(world, tool(name), 'wake', { label: 'a wake turn', arguments: argumentsFor(name) });
    expect(done.outcome).toBe('refused');
    expect(done.message).toBe('This tool needs a live PI activation. Nothing was done.');
  });
});

describe('a dependency is down: the tool fails in plain English, never with the generic failure', () => {
  // inbox_trail is not listed for the vault: the inbox store lets the vault client's plain errors through, so it answers with the
  // generic failure. That is reported for Dan's decision (see the report), not changed here.
  const outages: readonly (readonly [dependency: string, tools: readonly string[]])[] = [
    [situationDown, ['situation_read', 'situation_lookup', 'situation_patch', 'situation_commit', 'message_dan']],
    [locationDown, ['situation_lookup']],
    [vaultDown, ['pi_note', 'watch_create', 'watch_list', 'watch_update', 'watch_stop', 'watch_look']],
  ];
  for (const [dependency, names] of outages) {
    it.each(names)(`%s with ${dependency} down`, async (name) => {
      world.context.down.add(dependency);
      try {
        const done = await executeCase(world, tool(name), firstCase(name).turn ?? turnKindFor(name), firstCase(name));
        expect(done.outcome).toBe('error');
      } finally { world.context.down.delete(dependency); }
    });
  }
});
