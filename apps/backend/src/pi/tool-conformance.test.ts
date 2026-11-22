import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { MAX_CATALOGUE_BYTES, MAX_TOOL_DESCRIPTION_CHARACTERS, effectOf, isCurrentAssistantTool, isSituationActivationTool, isWakeTool, type RegisteredTool } from '../core/tool-registry.js';
import { readOnlyTools, writingTools } from '../core/tool-effects.js';
import { compactLargeSchema } from './compact-schema.js';
import { allGroups, buildConformanceWorld } from './conformance/world.testkit.js';
import { coreGroup } from './conformance/groups/core.testkit.js';
import { hours } from './conformance/groups/notes-cases.testkit.js';
import { notesGroup } from './conformance/groups/notes.testkit.js';
import { goldenIntents, phraseTable } from './conformance/phrases.testkit.js';
import { descriptionViolations, harnessManagedNames, nameViolations, schemaViolations, tokensOf } from './conformance/schema.testkit.js';
import type { ConformanceTurn } from './conformance/mcp-client.testkit.js';
import { executeCase, exerciseTool, openTurn, testTimeoutMs, turnKindFor, type CallableStatus } from './conformance/callable.testkit.js';
import type { ConformanceGroup } from './conformance/types.testkit.js';
import { largestSchemas, renderReport, renderTextTable, summarize, type ToolRow } from './conformance/report.testkit.js';

/**
 * Offline tool conformance: every tool the registry holds is checked against the harness contract (static), found by the
 * words Dan uses in English and Danish through the real `find_tools` (discoverable), and run through the real `call_tool` over
 * stubbed stores and services (callable). See docs/tool-conformance.md for the generated table and how to read it.
 */
const world = await buildConformanceWorld();
afterAll(async () => { await world.close(); });

type Visibility = 'chat' | 'activation' | 'wake' | 'legacy';
const visibilityOf = (name: string): Visibility => !isWakeTool(name) ? 'legacy'
  : isCurrentAssistantTool(name) ? 'chat'
    : isSituationActivationTool(name) ? 'activation' : 'wake';

const tools: readonly RegisteredTool[] = [...world.tools].sort((left, right) => left.name.localeCompare(right.name));
const names = tools.map((tool) => tool.name);
const visibleIn = (kind: 'chat' | 'wake') => tools.filter((tool) => kind === 'wake' ? visibilityOf(tool.name) !== 'legacy' : visibilityOf(tool.name) === 'chat' || visibilityOf(tool.name) === 'activation');

/** Largest schemas allowed above the default ceiling, with the reason. A new entry needs Dan's decision. */
const defaultSchemaTokens = 2_000;
const largeSchemas: Readonly<Record<string, { readonly ceiling: number; readonly reason: string }>> = {
  workspace_command: { ceiling: 13_000, reason: 'the inline generated-view schema (every renderer) is part of the tool schema' },
  show_in_chat: { ceiling: 13_500, reason: 'the inline generated-view schema (every renderer) is part of the tool schema' },
};
const defaultDefinitionTokens = 2_500;

const reports = new Map<string, {
  static?: string[]; discover?: { phrase: string; language: string; rank: number; source: 'curated' | 'derived' } | undefined;
}>();
const reportFor = (name: string) => {
  let entry = reports.get(name);
  if (!entry) { entry = {}; reports.set(name, entry); }
  return entry;
};

describe('composition', () => {
  const quickNames = ['calendar_list_events', 'owner_reminders', 'weather'];
  const expectedNames = ['call_tool', 'find_tools', ...quickNames].sort();
  it('exposes exactly the two door methods and the three quick tools, not the whole catalogue', async () => {
    expect(await world.client.listDoorTools()).toEqual(expectedNames);
  });

  it('gives the harness five safely named definitions with the required turn and the real quick tool schemas', async () => {
    const definitions = await world.client.listDoorDefinitions();
    expect(definitions.map((definition) => definition.name).sort()).toEqual(expectedNames);
    const turn = world.client.openTurn();
    try {
      for (const definition of definitions) {
        const { name, description } = definition;
        expect(name, 'a harness-safe name').toMatch(/^[A-Za-z0-9_-]{1,64}$/u);
        expect(name.includes('___'), `${name} must not contain ___`).toBe(false);
        const schema = definition.inputSchema ?? {};
        expect(schema.type, `${name} needs an object schema`).toBe('object');
        expect(JSON.stringify(schema), `${name} must not set strict`).not.toMatch(/"strict"\s*:\s*true/u);
        expect(schema.required).toContain('turn');
        const quick = quickNames.includes(name);
        expect(tokensOf({ ...definition }), `${name} is part of every turn: keep it small`).toBeLessThanOrEqual(quick ? 1_700 : 500);
        if (name === 'find_tools') for (const quickName of quickNames) expect(description).toContain(quickName);
        if (!quick) continue;
        const found = (await world.client.find(turn, name)).tools.find((tool) => tool.name === name)!;
        expect(description).toBe(found.description);
        expect(schema).toEqual({
          ...found.parameters,
          properties: { ...(found.parameters.properties as Record<string, unknown>), turn: expect.objectContaining({ type: 'string' }) },
          required: [...((found.parameters.required as string[] | undefined) ?? []), 'turn'],
        });
      }
    } finally {
      turn.close();
    }
    console.info(`Five MCP tool definitions cost about ${tokensOf(definitions)} tokens per turn (characters / 4).`);
  });

  it('composes every production module (a new key in production-modules.ts needs a conformance group)', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../production-modules.ts'), 'utf8');
    const interfaceBody = /export interface ProductionModules \{([\s\S]*?)\n\}/u.exec(source)?.[1] ?? '';
    const keys = [...interfaceBody.matchAll(/readonly (\w+)\??:/gu)].map((match) => match[1]!);
    expect(keys.length).toBeGreaterThan(20);
    const claimed = new Set(world.groups.flatMap((group) => group.covers));
    expect(keys.filter((key) => !claimed.has(key)), 'production modules no conformance group claims').toEqual([]);
    expect([...claimed].filter((key) => !keys.includes(key)), 'groups claim modules that do not exist').toEqual([]);
  });

  it('composes every tool factory production adds to the pi module (index.ts piModule)', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../index.ts'), 'utf8');
    const block = /const piModule = \{([\s\S]*?)registerRoutes:/u.exec(source)?.[1] ?? '';
    const factories = [...new Set([...block.matchAll(/\b(create\w+Tools)\(/gu)].map((match) => match[1]!))];
    expect(factories.length, 'no tool factories found in the piModule block of index.ts: update this guard').toBeGreaterThan(0);
    const groupsDir = resolve(import.meta.dirname, 'conformance/groups');
    const kit = readdirSync(groupsDir).filter((file) => file.startsWith('pi')).map((file) => readFileSync(resolve(groupsDir, file), 'utf8')).join('\n');
    expect(factories.filter((factory) => !kit.includes(factory)), 'tool factories the pi conformance group does not compose').toEqual([]);
  });

  it('keeps every tool of every module in the registry, each with exactly one visibility (at least 130 reach chat and voice)', () => {
    const counts = { chat: 0, activation: 0, wake: 0, legacy: 0 };
    for (const tool of tools) counts[visibilityOf(tool.name)] += 1;
    expect(counts.chat).toBeGreaterThanOrEqual(130);
    expect(tools.length).toBe(counts.chat + counts.activation + counts.wake + counts.legacy);
  });

  it('keeps the whole catalogue within the agent limits', () => {
    const bytes = Buffer.byteLength(JSON.stringify(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))));
    expect(bytes).toBeLessThanOrEqual(MAX_CATALOGUE_BYTES);
    expect(tools.every((tool) => tool.description.length <= MAX_TOOL_DESCRIPTION_CHARACTERS)).toBe(true);
  });

  it('knows what every tool does to the world, so the door counts what Jarvis wrote and does not write a replay twice', () => {
    const names = new Set(tools.map((tool) => tool.name));
    const unaccounted = tools.filter((tool) => tool.execution === undefined && !readOnlyTools.has(tool.name)).map((tool) => tool.name);
    expect(unaccounted, 'tools with no declared effect: list a tool that writes in writingTools and one that only reads or shows in readOnlyTools (core/tool-effects.ts), or give it execution metadata').toEqual([]);
    expect([...Object.keys(writingTools), ...readOnlyTools].filter((name) => !names.has(name)), 'tool-effects.ts names a tool that does not exist').toEqual([]);
    expect([...readOnlyTools].filter((name) => names.has(name) && tools.find((tool) => tool.name === name)!.execution !== undefined),
      'a tool listed as read-only that also declares an effect').toEqual([]);
    // The registry lets a tool's own declaration win over the table, so one that differs would hide its row. The suite sees only the
    // merged value, so an identical second declaration passes: that is harmless, it repeats the row.
    expect(Object.entries(writingTools).filter(([name, effect]) => !isDeepStrictEqual(tools.find((tool) => tool.name === name)?.execution, effect)).map(([name]) => name),
      'a tool is in writingTools (core/tool-effects.ts) and its own execution metadata says something else: keep one of the two').toEqual([]);
  });
});

describe('quick tools through the real MCP door', () => {
  it('reads Google Calendar directly and returns the same result as the generic call, even on a short page', async () => {
    const turn = world.client.openTurn();
    try {
      const args = { start: '2026-11-23', end: '2026-11-29', maxResults: 3 };
      const direct = await world.client.direct(turn, 'calendar_list_events', args);
      const generic = await world.client.call(turn, 'calendar_list_events', args);
      expect(direct.outcome).toBe('ok');
      expect(direct.result).toMatchObject({ events: expect.any(Array), truncated: true });
      expect(direct.truncated).toBe(false); // The tool paged its result; the door did not shorten it.
      expect(direct.raw).toBe(generic.raw);
      expect(effectOf(world.app.jarvisTools.get('calendar_list_events')!, args)).toBe('read');
      expect(turn.grant.actions.count).toBe(0);
    } finally {
      turn.close();
    }
  });

  it('reads weather without a report and still creates a report by default', async () => {
    const turn = world.client.openTurn();
    try {
      const args = { location: 'Aarhus', days: 2 };
      const read = await world.client.direct(turn, 'weather', { ...args, report: false }, 'weather-read');
      expect(read.outcome).toBe('ok');
      expect(read.result).toMatchObject({ forecast: expect.any(Array) });
      expect(read.result).not.toHaveProperty('artifactId');
      expect(turn.grant.actions.count).toBe(0);
      const report = await world.client.direct(turn, 'weather', args, 'weather-report');
      expect(report.outcome).toBe('ok');
      expect(report.result).toMatchObject({ artifactId: expect.any(String), jobId: expect.any(String) });
      const replay = await world.client.call(turn, 'weather', args, undefined, 'weather-report');
      expect(JSON.parse(replay.raw)).toEqual({ ...JSON.parse(report.raw), duplicate: true });
      expect(turn.grant.actions.count).toBe(1);
    } finally {
      turn.close();
    }
  });

  it('applies the reminder schema and replays a direct reminder write through call_tool without another dispatch', async () => {
    const reminders = await buildConformanceWorld({ groups: [coreGroup, notesGroup] });
    reminders.context.ownerMessage.text = 'Remind me in two hours to call the dentist';
    const turn = reminders.client.openTurn();
    try {
      const invalid = await reminders.client.direct(turn, 'owner_reminders', { operation: 'read', task: 'Call the dentist' });
      expect(invalid.outcome).toBe('refused');
      expect(invalid.result).toMatchObject({ refused: expect.stringContaining('read accepts only operation') });
      const args = { operation: 'create', task: 'Call the dentist', fireAt: hours(2) };
      const direct = await reminders.client.direct(turn, 'owner_reminders', args, 'reminder-1');
      const duplicate = await reminders.client.call(turn, 'owner_reminders', args, undefined, 'reminder-1');
      expect(direct.outcome).toBe('ok');
      expect(direct.result).toMatchObject({ operation: 'create', created: true, confirmation: expect.stringContaining('saved and scheduled') });
      expect(JSON.parse(duplicate.raw)).toEqual({ ...JSON.parse(direct.raw), duplicate: true });
      expect(turn.grant.actions.count).toBe(1);
      expect(reminders.recorded.filter((entry) => entry.tool === 'owner_reminders')).toHaveLength(1);
    } finally {
      turn.close();
      await reminders.close();
    }
  });
});

describe('static: the harness contract', () => {
  it.each(names)('%s', (name) => {
    const tool = world.app.jarvisTools.get(name)!;
    const problems = [
      ...nameViolations(name, names),
      ...descriptionViolations(tool),
      ...schemaViolations(tool.inputSchema),
    ];
    const schemaTokens = tokensOf(tool.inputSchema);
    const ceiling = largeSchemas[name]?.ceiling ?? defaultSchemaTokens;
    if (schemaTokens > ceiling) problems.push(`the schema is ${schemaTokens} tokens (ceiling ${ceiling}); every find_tools answer that returns it pays that`);
    const definitionTokens = tokensOf({ name, description: tool.description, parameters: tool.inputSchema });
    if (definitionTokens > (largeSchemas[name]?.ceiling ?? 0) + defaultDefinitionTokens && definitionTokens > defaultDefinitionTokens) {
      problems.push(`the definition is ${definitionTokens} tokens`);
    }
    reportFor(name).static = problems;
    expect(problems, `${name}: ${problems.join('; ')}`).toEqual([]);
  });

  it('keeps the harness-managed names out of the catalogue', () => {
    expect(names.filter((name) => harnessManagedNames.has(name))).toEqual([]);
  });

  it('prints the 15 largest schemas (the per-turn cost when a search returns them)', () => {
    const largest = tools
      .map((tool) => ({ name: tool.name, schema: tokensOf(tool.inputSchema), definition: tokensOf({ name: tool.name, description: tool.description, parameters: tool.inputSchema }) }))
      .sort((left, right) => right.schema - left.schema || left.name.localeCompare(right.name))
      .slice(0, 15);
    console.info(`Largest tool schemas (tokens = characters / 4):\n${largest.map((entry, index) => `${String(index + 1).padStart(2)}. ${entry.name.padEnd(26)} schema ${String(entry.schema).padStart(6)}   definition ${String(entry.definition).padStart(6)}`).join('\n')}`);
    expect(largest).toHaveLength(15);
  });
});

// ---- Discoverability ---------------------------------------------------------------------------------------------------------

const searches = new Map<string, Promise<{ readonly top: readonly string[]; readonly listed: readonly string[] }>>();
const chatTurn: ConformanceTurn = world.client.openTurn();
const wakeTurn: ConformanceTurn = world.client.openTurn({ wake: true });
afterAll(() => { chatTurn.close(); wakeTurn.close(); });

/**
 * What find_tools returns for a query: `top` are the 3 tools it describes in full, `listed` adds the five compact otherMatches
 * entries, which can be called by exact name too.
 */
async function search(query: string, kind: 'chat' | 'wake' = 'chat') {
  const key = `${kind}:${query}`;
  let found = searches.get(key);
  if (!found) {
    found = world.client.find(kind === 'wake' ? wakeTurn : chatTurn, query).then((answer) => ({
      top: answer.tools.map((tool) => tool.name),
      listed: [...answer.tools, ...answer.otherMatches].map((tool) => tool.name),
    }));
    searches.set(key, found);
  }
  return found;
}
const topThree = async (query: string, kind: 'chat' | 'wake' = 'chat') => (await search(query, kind)).top;

const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'when', 'what', 'into', 'only', 'does', 'not', 'are', 'was', 'his', 'her', 'its', 'one', 'any', 'all', 'use', 'used', 'using', 'dan', 'dans', 'tool', 'tools']);
const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4 && !stopWords.has(word));
/** How many tools' descriptions use each word: the rarer a word, the more it says about one tool. */
const documentFrequency = new Map<string, number>();
for (const tool of tools) for (const word of new Set(wordsOf(tool.description))) documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);

/** Queries a model could write from the tool's own description: its sentences in order, then its most distinctive words. */
export function derivedQueries(tool: Pick<RegisteredTool, 'name' | 'description'>): readonly { readonly strategy: string; readonly query: string }[] {
  const text = tool.description.replace(/\s+/gu, ' ').trim();
  const clip = (value: string) => value.length <= 100 ? value : value.slice(0, value.lastIndexOf(' ', 100) > 0 ? value.lastIndexOf(' ', 100) : 100);
  const sentences = (text.match(/[^.!?;]+[.!?;]?(?=\s|$)/gu) ?? [text]).map((sentence) => sentence.trim().replace(/[.!?;]+$/u, '')).filter((sentence) => sentence.split(' ').length >= 3);
  const distinctive = [...new Set(wordsOf(text))]
    .sort((left, right) => (documentFrequency.get(left) ?? 0) - (documentFrequency.get(right) ?? 0) || right.length - left.length || left.localeCompare(right))
    .slice(0, 5);
  return [
    ...sentences.slice(0, 4).map((sentence, index) => ({ strategy: `sentence ${index + 1}`, query: clip(sentence) })),
    ...(distinctive.length > 0 ? [{ strategy: 'distinctive words', query: distinctive.join(' ') }] : []),
  ];
}

const curated = phraseTable.flatMap((row) => [
  { ...row, language: 'en', phrase: row.en }, { ...row, language: 'da', phrase: row.da },
]);
/** The first phrase of the table (English before Danish) that puts the tool in the top 3. Searched here, so the report does not depend on test order. */
async function curatedHitFor(name: string): Promise<{ phrase: string; language: string; rank: number } | undefined> {
  for (const entry of curated) {
    if (!entry.tools.includes(name)) continue;
    const rank = (await topThree(entry.phrase)).indexOf(name) + 1;
    if (rank > 0) return { phrase: entry.phrase, language: entry.language, rank };
  }
  return undefined;
}

describe('discoverable: Dan’s words find the right tool in the top 3 of the first search', () => {
  it.each(curated.map((entry) => [`${entry.intent} (${entry.language}): ${entry.phrase}`, entry] as const))('%s', async (_title, entry) => {
    const top = await topThree(entry.phrase);
    const rank = top.findIndex((name) => entry.tools.includes(name));
    expect(rank, `top 3 for "${entry.phrase}": ${top.join(', ')}; expected one of ${entry.tools.join(', ')}`).toBeGreaterThanOrEqual(0);
  });

  it.each(visibleIn('wake').map((tool) => tool.name))('every tool is found by a phrase of its own: %s', async (name) => {
    const tool = world.app.jarvisTools.get(name)!;
    const kind = visibilityOf(name) === 'wake' ? 'wake' : 'chat';
    const curatedHit = await curatedHitFor(name);
    if (curatedHit) { reportFor(name).discover = { ...curatedHit, source: 'curated' }; return; }
    // The first derived query that puts the tool in the top 3 wins; failing that, the best listed rank (callable by exact name).
    const tried: string[] = [];
    let best: { phrase: string; rank: number } | undefined;
    for (const candidate of derivedQueries(tool)) {
      const { top, listed } = await search(candidate.query, kind);
      tried.push(`${candidate.strategy} "${candidate.query}" -> ${top.join(', ') || 'nothing'}`);
      const rank = listed.indexOf(name) + 1;
      if (rank > 0 && (!best || rank < best.rank)) best = { phrase: candidate.query, rank };
      if (rank > 0 && rank <= 3) break;
    }
    expect(best, `${name} was not returned by find_tools for any query derived from its description:\n${tried.join('\n')}`).toBeDefined();
    reportFor(name).discover = { phrase: best!.phrase, language: 'en', rank: best!.rank, source: 'derived' };
  });

  it('never offers the legacy confirmation tools to chat or voice', async () => {
    const legacy = tools.filter((tool) => visibilityOf(tool.name) === 'legacy').map((tool) => tool.name);
    expect(legacy.length).toBeGreaterThan(0);
    for (const name of legacy) {
      const answer = await world.client.find(chatTurn, name.replace(/_/gu, ' '));
      expect([...answer.tools, ...answer.otherMatches].map((entry) => entry.name)).not.toContain(name);
    }
  });
});

describe('golden intents are pinned to tools that exist', () => {
  it.each(goldenIntents.map((entry) => [`${entry.scenario}: ${entry.step} -> ${entry.tools.join(' or ')}`, entry] as const))('%s', (_title, entry) => {
    expect(entry.tools.filter((tool) => !names.includes(tool))).toEqual([]);
  });
});

// ---- Callable ----------------------------------------------------------------------------------------------------------------

const groupOfModule = new Map<string, ConformanceGroup>();
for (const group of world.groups) for (const module of group.modules) groupOfModule.set(module.id, group);
const groupOfTool = (name: string) => groupOfModule.get(world.app.jarvisTools.get(name)!.moduleId);
/** `CONFORMANCE_GROUP=google` runs only the callable checks of one group while its stubs are being built. */
const onlyGroup = process.env.CONFORMANCE_GROUP;
const callable = new Map<string, CallableStatus>();

describe('callable: every tool runs through the real call_tool over stubbed stores and services', () => {
  it.for(names)('%s', { timeout: testTimeoutMs }, async (name, context) => {
    const group = groupOfTool(name);
    if (onlyGroup && group?.id !== onlyGroup) return context.skip();
    expect(group, `${name} belongs to a module no conformance group composes`).toBeDefined();
    callable.set(name, await exerciseTool(world, world.app.jarvisTools.get(name)!, group));
  });
});

// ---- Size limits ---------------------------------------------------------------------------------------------------------------

describe('size: the door bounds what the model sees without changing what the tools accept or return', () => {
  it('lets a 400 KB HTML app through (create_html_view allows 512 KB; the door used to refuse anything above 256 KB with HTTP 413)', { timeout: testTimeoutMs }, async () => {
    const tool = world.app.jarvisTools.get('create_html_view')!;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Large app</title></head><body><p>${'x'.repeat(400_000)}</p></body></html>`;
    const done = await executeCase(world, tool, 'chat', { label: 'large app', arguments: { title: 'Large app', html, sources: [] } });
    expect(done.outcome, `create_html_view answered ${done.outcome} ("${done.message ?? ''}")`).toBe('ok');
  });

  it('shortens the full capability list only at the door, without changing the route’s tools or features', async () => {
    const turn = world.client.openTurn();
    try {
      const response = await world.app.inject({
        method: 'POST', url: '/tools/list_capabilities', payload: {},
        headers: {
          authorization: `Bearer ${world.auth.dispatch.token}`, 'x-jarvis-pi': 'turn', 'x-jarvis-message-id': turn.grant.messageId,
        },
      });
      expect(response.statusCode).toBe(200);
      const full = response.json<{ outcome: string; result: { tools: unknown[]; features: unknown[] } }>();
      expect(full.outcome).toBe('ok');
      expect(full.result.tools.length).toBeGreaterThan(0);
      expect(full.result.features.length).toBeGreaterThan(0);
      await world.client.find(turn, 'list_capabilities');
      const preview = await world.client.call(turn, 'list_capabilities', {});
      expect(preview.outcome).toBe('ok');
      expect(preview.result).toMatchObject({ truncated: true, totalCharacters: JSON.stringify(full.result).length });
      expect(JSON.stringify(preview.result).length).toBeLessThanOrEqual(24_000);
    } finally {
      turn.close();
    }
  });
});

// ---- Remote bridges ----------------------------------------------------------------------------------------------------------

/** A door with no local tools and fresh stub GitHub and Azure servers: the bridge behaviour is what is under test. */
async function remoteWorld(bridge: { now?: () => number; searchWaitMs?: number } = {}) {
  const remote = await buildConformanceWorld({ groups: [], bridge: { searchWaitMs: 150, ...bridge } });
  const turn = remote.client.openTurn();
  const found = async (query: string) => {
    const answer = await remote.client.find(turn, query);
    return { names: [...answer.tools, ...answer.otherMatches].map((tool) => tool.name), note: answer.note };
  };
  return { remote, turn, found, [Symbol.asyncDispose]: async () => { turn.close(); await remote.close(); } };
}

describe('remote: the gh_ and az_ bridges behind the door', () => {
  it('loads nothing for a local search, and only the provider the query names', async () => {
    await using door = await remoteWorld();
    const { remote, found } = door;
    await found('weather tomorrow');
    expect(remote.remote.github.seen).toEqual([]);
    expect(remote.remote.azure.seen).toEqual([]);
    expect(remote.bridges.map((bridge) => bridge.status().state)).toEqual(['idle', 'idle']);
    const github = await found('list my github pull requests');
    expect(github.names).toContain('gh_list_pull_requests');
    expect(remote.bridges.map((bridge) => bridge.status().state)).toEqual(['ready', 'idle']);
    expect(remote.remote.azure.seen).toEqual([]);
    const azure = await found('list my azure resource groups');
    expect(azure.names).toContain('az_group_list');
    expect(remote.bridges.map((bridge) => bridge.status().state)).toEqual(['ready', 'ready']);
  });

  it('says a server that is still waking is attached but not loaded (idle, starting, then ready)', async () => {
    await using door = await remoteWorld();
    const { remote, found } = door;
    let wake!: () => void;
    remote.remote.azure.controls.gate = new Promise<void>((resolve) => { wake = resolve; });
    expect(remote.bridges[1]!.status()).toEqual({ state: 'idle' });
    const starting = await found('azure resource groups');
    expect(starting.names.filter((name) => name.startsWith('az_'))).toEqual([]);
    expect(starting.note).toMatch(/Azure tools are still loading/u);
    expect(starting.note).toMatch(/attached, just not loaded yet/u);
    expect(remote.bridges[1]!.status()).toEqual({ state: 'starting' });
    wake();
    await vi.waitFor(async () => expect((await found('azure resource groups')).names).toContain('az_group_list'), { timeout: 2_000 });
    expect(remote.bridges[1]!.status()).toEqual({ state: 'ready' });
  });

  it('keeps the last list and says so when a refresh fails (stale), and recovers at the next refresh', async () => {
    let clock = 0;
    await using door = await remoteWorld({ now: () => clock });
    const { remote, found } = door;
    expect((await found('github issues')).names).toContain('gh_issue_read');
    clock += 31 * 60_000;
    remote.remote.github.controls.listFailure = 503;
    const stale = await found('github issues');
    expect(stale.names).toContain('gh_issue_read');
    expect(stale.note).toMatch(/last loaded tool list because the refresh failed \(the server answered HTTP 503\)/u);
    expect(remote.bridges[0]!.status()).toEqual({ state: 'stale', reason: 'the server answered HTTP 503' });
    remote.remote.github.controls.listFailure = undefined;
    clock += 2 * 60_000;
    expect((await found('github issues')).note).toBeUndefined();
    expect(remote.bridges[0]!.status()).toEqual({ state: 'ready' });
  });

  it('says a server that cannot be reached is unreachable, never "not attached", and tries again at the next search', async () => {
    await using door = await remoteWorld();
    const { remote, turn, found } = door;
    remote.remote.github.controls.listFailure = 'network';
    const down = await found('github issues');
    expect(down.names.filter((name) => name.startsWith('gh_'))).toEqual([]);
    expect(down.note).toMatch(/GitHub could not be reached \(the connection failed\)\. Say so plainly; do not claim to have looked\./u);
    expect(remote.bridges[0]!.status()).toEqual({ state: 'unreachable', reason: 'the connection failed' });
    const refused = await remote.client.call(turn, 'gh_issue_read', { method: 'get', owner: 'o', repo: 'r', issue_number: 1 });
    expect(refused.outcome).toBe('refused');
    remote.remote.github.controls.listFailure = undefined;
    expect((await found('github issues')).names).toContain('gh_issue_read');
    expect(remote.bridges[0]!.status()).toEqual({ state: 'ready' });
  });

  it('runs a discovered remote tool and refuses one that was never looked up', async () => {
    await using door = await remoteWorld();
    const { remote, turn, found } = door;
    const unknown = await remote.client.call(turn, 'gh_issue_read', { method: 'get', owner: 'o', repo: 'r', issue_number: 12 });
    expect(unknown.outcome).toBe('refused');
    await found('github issue');
    const done = await remote.client.call(turn, 'gh_issue_read', { method: 'get', owner: 'o', repo: 'r', issue_number: 12 });
    expect(done.outcome).toBe('ok');
    expect(done.result).toMatchObject({ ok: true, tool: 'issue_read', echo: { issue_number: 12 } });
    expect(remote.remote.github.seen.at(-1)).toEqual({ method: 'tools/call', tool: 'issue_read' });
    expect(turn.grant.results.at(-1)).toEqual({ tool: 'gh_issue_read', outcome: 'ok' });
  });

  it('reports a remote tool that fails as an error with the server’s own words', async () => {
    await using door = await remoteWorld();
    const { remote, turn, found } = door;
    await found('github issue');
    remote.remote.github.controls.erroringTool = { name: 'issue_read', text: 'Not Found: no such issue' };
    const failed = await remote.client.call(turn, 'gh_issue_read', { method: 'get', owner: 'o', repo: 'r', issue_number: 404 });
    expect(failed.outcome).toBe('error');
    expect(failed.isError).toBe(true);
    expect(failed.result).toEqual({ error: 'Not Found: no such issue' });
    expect(turn.grant.results.at(-1)).toEqual({ tool: 'gh_issue_read', outcome: 'error' });
  });

  it('shortens a remote read at an array boundary and gives its original size', async () => {
    await using door = await remoteWorld();
    const { remote, turn, found } = door;
    await found('gh_search_code');
    const rows = [{ text: 'æ'.repeat(15_000) }, { text: 'ø'.repeat(15_000) }];
    remote.remote.github.controls.toolResult = { name: 'search_code', value: rows };
    const big = await remote.client.call(turn, 'gh_search_code', { query: 'jarvis' });
    expect(big.outcome).toBe('ok');
    const result = big.result as { truncated: boolean; preview: string; note: string };
    expect(result).toMatchObject({
      truncated: true, totalCharacters: JSON.stringify(rows).length,
      note: 'Result shortened; narrow the query by limit, date range or path and call again.',
    });
    expect(JSON.parse(result.preview)).toEqual(rows.slice(0, 1));
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000);
  });

  it('leaves an under-cap remote read and an over-cap remote write unchanged', async () => {
    await using door = await remoteWorld();
    const { remote, turn, found } = door;
    await found('gh_search_code');
    const small = { rows: 'x'.repeat(1_000) };
    remote.remote.github.controls.toolResult = { name: 'search_code', value: small };
    const fullRead = await remote.client.call(turn, 'gh_search_code', { query: 'jarvis' });
    expect(fullRead.result).toEqual(small);
    await found('gh_issue_write');
    const write = { rows: 'x'.repeat(40_000), receipt: { number: 123 }, confirmation: 'Issue created.' };
    remote.remote.github.controls.toolResult = { name: 'issue_write', value: write };
    const fullWrite = await remote.client.call(turn, 'gh_issue_write', { method: 'create', owner: 'o', repo: 'r', title: 'A fixture issue' });
    expect(fullWrite.outcome).toBe('ok');
    expect(fullWrite.result).toEqual(write);
  });

  it('answers cleanly when the remote server drops during a call', async () => {
    await using door = await remoteWorld();
    const { remote, turn, found } = door;
    await found('azure resources');
    remote.remote.azure.controls.gate = Promise.reject(new TypeError('fetch failed'));
    remote.remote.azure.controls.gate.catch(() => {});
    const dropped = await remote.client.call(turn, 'az_group_list', {});
    expect(dropped.outcome).toBe('error');
    expect(dropped.result).toEqual({ error: 'Azure could not be reached. Nothing is confirmed as done.' });
  });
});

// ---- Golden daily-core scenarios ----------------------------------------------------------------------------------------------

const confirmationMarkers = /confirmationCode|requiresConfirmation|needsApproval|awaitingApproval|"pending"\s*:\s*true|"status"\s*:\s*"(?:pending|proposal|proposed|staged|needs_[a-z_]+|awaiting_[a-z_]+)"/iu;
const scenarios = world.groups.flatMap((group) => (group.scenarios ?? []).map((scenario) => ({ group, scenario })));

describe('golden scenarios: one turn, no confirmation step, found on the first search', () => {
  it('covers every scenario step Dan named', () => {
    const missing = goldenIntents.filter((intent) => !scenarios.some(({ scenario }) => scenario.id === intent.scenario
      && scenario.steps.some((step) => intent.tools.includes(step.tool))));
    expect(missing.map((intent) => `${intent.scenario}: ${intent.step} (${intent.tools.join(' or ')})`)).toEqual([]);
  });

  for (const { scenario } of scenarios) {
    for (const language of ['en', 'da'] as const) {
      it(`${scenario.title} (${language})`, { timeout: testTimeoutMs }, async (context) => {
        if (onlyGroup && !world.groups.some((group) => group.id === onlyGroup && group.scenarios?.includes(scenario))) return context.skip();
        for (const step of scenario.steps) {
          const phrase = step.say[language];
          const top = await topThree(phrase);
          expect(top, `"${phrase}" must find ${step.tool} in the top 3 of the first search, got ${top.join(', ')}`).toContain(step.tool);
          const tool = world.app.jarvisTools.get(step.tool)!;
          // Each spoken request is its own turn; the stored Dan message is exactly what he said.
          const done = await executeCase(world, tool, step.call.turn ?? turnKindFor(step.tool), {
            label: `${scenario.id}: ${phrase}`, arguments: step.call.arguments, ownerMessage: step.call.ownerMessage ?? phrase,
          });
          const wanted = step.call.expect ?? 'ok';
          expect(done.outcome, `"${phrase}" -> ${step.tool} answered ${done.outcome} ("${done.message ?? ''}"), expected ${wanted}`).toBe(wanted);
          expect(JSON.stringify(done.result ?? null), `"${phrase}" -> ${step.tool} asked for a confirmation step`).not.toMatch(confirmationMarkers);
          try { step.call.check?.(done.result); }
          catch (error) {
            if (error instanceof Error) error.message = `"${phrase}" -> ${step.tool}: ${error.message}`;
            throw error;
          }
        }
      });
    }
  }
});

// Keep the module referenced for the groups listed in the report.
void allGroups;
void openTurn;

// ---- The generated report ------------------------------------------------------------------------------------------------------

describe('report', () => {
  it('prints one row per tool and keeps docs/tool-conformance.md in step with the registry', () => {
    // The report needs every phase's result for every tool: with a test filter, CONFORMANCE_GROUP, or a shuffled order that put this
    // test before the others, some are missing and the comparison is skipped.
    const complete = tools.every((tool) => {
      const entry = reports.get(tool.name);
      return entry?.static !== undefined && callable.has(tool.name) && (visibilityOf(tool.name) === 'legacy' || entry.discover !== undefined);
    });
    if (!complete || onlyGroup) {
      console.info('Partial run (a test filter, CONFORMANCE_GROUP or the test order left results out): the report is not compared with docs/tool-conformance.md.');
      return;
    }
    const rows: ToolRow[] = tools.map((tool) => {
      const entry = reportFor(tool.name);
      const status = callable.get(tool.name);
      const group = groupOfTool(tool.name);
      return {
        name: tool.name, group: group?.id ?? 'none', visibility: visibilityOf(tool.name),
        effect: tool.execution?.defaultEffect ?? 'unclassified',
        staticProblems: entry.static ?? [], discover: entry.discover, callable: status,
        schemaTokens: tokensOf(tool.inputSchema), sentTokens: tokensOf(compactLargeSchema(tool.inputSchema)),
        definitionTokens: tokensOf({ name: tool.name, description: tool.description, parameters: tool.inputSchema }),
        notes: [
          ...(largeSchemas[tool.name] ? [`large schema: ${largeSchemas[tool.name]!.reason}`] : []),
          ...(status?.kind === 'requiresExternal' ? [`needs outside help: ${status.reason}`] : []),
          ...(status?.kind === 'skipped' ? [`skipped: ${status.reason}`] : []),
          ...(visibilityOf(tool.name) === 'legacy' ? ['kept for cached clients; the door refuses it'] : []),
        ],
      };
    });
    const summary = summarize(rows);
    console.info(`Per-tool table (the same rows are committed in docs/tool-conformance.md):\n${renderTextTable(rows)}`);
    console.info(`Tool conformance summary: ${JSON.stringify(summary)}`);
    console.info(`Largest schemas (tokens = characters / 4):\n${largestSchemas(rows).map((row, index) => `${String(index + 1).padStart(2)}. ${row.name.padEnd(26)} schema ${String(row.schemaTokens).padStart(6)}  sent ${String(row.sentTokens).padStart(6)}  definition ${String(row.definitionTokens).padStart(6)}`).join('\n')}`);
    const markdown = renderReport(rows, { ceiling: defaultSchemaTokens, oversize: largeSchemas });
    const file = resolve(import.meta.dirname, '../../../../docs/tool-conformance.md');
    if (process.env.UPDATE_TOOL_CONFORMANCE === '1') {
      writeFileSync(file, markdown);
      return;
    }
    const committed = existsSync(file) ? readFileSync(file, 'utf8') : '';
    expect(committed === markdown, 'docs/tool-conformance.md is out of date with the registry. Regenerate it: cd apps/backend && UPDATE_TOOL_CONFORMANCE=1 npx vitest run src/pi/tool-conformance.test.ts').toBe(true);
  });
});
