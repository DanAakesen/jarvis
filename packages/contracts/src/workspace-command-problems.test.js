import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generatedViewRenderers,
  generatedViewSchema,
  isWorkspaceCommand,
  workspaceCommandProblems,
  workspaceCommandSchema,
} from './index.js';

const registeredTools = ['mail_search', 'workspace_command'];
const options = { registeredTools, trustedBlobHost: 'jarvisblob.blob.core.windows.net' };

const validData = {
  table: { columns: ['City', 'Nights'], rows: [['Aarhus', 2], ['Odense', null]] },
  list: {
    items: [{
      title: 'Hotel A',
      description: 'Two nights',
      details: [{ label: 'Price', value: '120 EUR' }],
      action: { type: 'open-route', route: '/usage' },
    }],
  },
  detail: { fields: [{ label: 'Label', value: 'Value' }] },
  text: { format: 'markdown', content: 'Hello' },
  timeline: {
    events: [
      { at: '2026-01-31', title: 'A' },
      { at: '2026-01-31T09:00:00+01:00', title: 'B' },
      { label: 'Q1 2026', title: 'C' },
    ],
  },
  chart: { kind: 'line', series: [{ name: 'S', points: [{ x: 1, y: 2 }, { x: 'b', y: 3 }] }] },
  'task-card': { id: 't1', title: 'Task', state: 'open', summary: 'Summary' },
  status: { label: 'Backend', state: 'ok', value: 'fine' },
  image: {
    images: [
      { url: 'https://github.com/acme/logo.png', alt: 'Logo' },
      { url: 'https://jarvisblob.blob.core.windows.net/a.png', alt: 'Stored' },
    ],
  },
  'html-app': { artifactId: '123e4567-e89b-42d3-a456-426614174000' },
  'knowledge-graph': { query: 'who owns what', highlight: ['a'.repeat(64)] },
  code: { repo: 'acme/jarvis', path: 'src/a.ts', content: 'const a = 1;' },
};

const viewFor = (renderer) => ({
  version: 1,
  title: 'Title',
  renderer,
  source: { id: 'now', status: 'complete', updatedAt: '2026-01-31T09:00:00Z' },
  data: structuredClone(validData[renderer]),
});
const cleanList = () => ({
  version: 1,
  title: 'Hotels in Copenhagen',
  renderer: 'list',
  source: { id: 'now', status: 'complete' },
  data: { items: [{ title: 'Hotel A', description: 'Two nights' }, { title: 'Hotel B' }] },
});
const create = (view = cleanList(), extra = {}) => ({
  commandId: 'cmd-1', operation: 'create', viewId: 'hotels', view, ...extra,
});
const command = (value) => ({ commandId: 'c1', ...value });

function mutate(base, path, value) {
  const copy = structuredClone(base);
  let target = copy;
  for (const key of path.slice(0, -1)) target = target[key];
  const last = path[path.length - 1];
  if (value === undefined) delete target[last];
  else target[last] = value;
  return copy;
}

function explain(value, callOptions = options) {
  const problems = workspaceCommandProblems(value, callOptions);
  assert.ok(problems.length <= 3, 'at most three problems');
  for (const { path, problem } of problems) {
    assert.ok(path.length > 0 && path.length <= 200, `path length: ${path}`);
    assert.ok(problem.length > 0 && problem.length <= 420, `problem length: ${path}`);
    assert.ok(!problem.includes(';'), 'problems avoid semicolons so the caller can join them with one');
  }
  return problems;
}

const validCommands = [
  { operation: 'navigate', page: 'usage' },
  { operation: 'navigate', page: 'settings', section: 'voice' },
  { operation: 'navigate', page: 'factory', taskId: '42', issueNumber: 7 },
  { operation: 'conversation', action: 'show' },
  { operation: 'session', action: 'language', value: 'da' },
  { operation: 'session', action: 'voice', value: 'end' },
  { operation: 'session', action: 'camera', value: 'front' },
  { operation: 'create', viewId: 'v1', view: cleanList() },
  { operation: 'update', viewId: 'v1', view: cleanList() },
  ...['show', 'close', 'minimise', 'restore', 'focus', 'pin', 'unpin'].map((operation) => ({ operation, viewId: 'v1' })),
  { operation: 'place', viewId: 'v1', region: 'left' },
  { operation: 'arrange', layout: 'grid' },
  { operation: 'arrange', layout: 'side-by-side', viewIds: ['v1', 'v2'] },
  { operation: 'minimise-all' },
  { operation: 'restore-all' },
  { operation: 'close-all' },
  { operation: 'move', viewId: 'v1', x: 0.25, y: 0.5 },
  { operation: 'resize', viewId: 'v1', width: 0.5, height: 0.5 },
  { operation: 'resize', viewId: 'v1', width: 0.5, height: 0.5, x: 0.4, y: 0.4 },
  { operation: 'layout', arrangement: 'tiled' },
  { operation: 'context-panel', action: 'open' },
  { operation: 'context-panel', action: 'open', view: cleanList() },
  { operation: 'context-panel', action: 'toggle' },
  { operation: 'context-panel', action: 'close' },
  { operation: 'close-all', target: 'phone' },
].map((value, index) => ({ commandId: `c${index}`, ...value }));

test('valid commands for every operation and renderer need no explanation', () => {
  const operations = new Set(validCommands.map(({ operation }) => operation));
  assert.deepEqual([...operations].sort(), [...workspaceCommandSchema.properties.operation.enum].sort());
  for (const value of [...validCommands, ...generatedViewRenderers.map((renderer) => create(viewFor(renderer)))]) {
    assert.equal(isWorkspaceCommand(value, options), true, JSON.stringify(value).slice(0, 120));
    assert.deepEqual(workspaceCommandProblems(value, options), []);
  }
});

const refusedShapes = [
  [
    'a source id that is not an allowed source',
    create({ ...cleanList(), source: { id: 'gmail', status: 'complete' } }),
    'view.source.id',
    /^must be one of now, factory\.tasks, factory\.projects, usage, image_generation, html_generation, research or knowledge_graph \(use now when none of the others fit\)$/,
  ],
  [
    'a call-tool action for a tool that is not registered',
    create({ ...cleanList(), actions: [{ type: 'call-tool', tool: 'gmail_search' }] }),
    'view.actions[0].tool',
    /^is not a registered tool \(use an exact tool name from your tool list, or leave the action out\)$/,
  ],
  [
    'an open-link host that is not allowed',
    create({
      ...cleanList(),
      data: { items: [{ title: 'Hotel', action: { type: 'open-link', url: 'https://booking.example/hotel', label: 'Open' } }] },
    }),
    'view.data.items[0].action.url',
    /^must be an https link on github\.com, learn\.microsoft\.com, azure\.com or \*\.azure\.com/,
  ],
  [
    'a view sent as a JSON string',
    create(JSON.stringify(cleanList())),
    'view',
    /^must be a JSON object, not text containing JSON, like \{"version":1,/,
  ],
  [
    'create without viewId and view',
    { commandId: 'c1', operation: 'create' },
    'viewId',
    /^is required, and must start with a letter/,
  ],
  [
    'create with window placement mixed in',
    create(cleanList(), { region: 'left', x: 0.1, y: 0.1 }),
    'region, x, y',
    /^not allowed with operation create, which takes viewId and view only \(position a view with a separate place, arrange, move or resize command\)$/,
  ],
  [
    'a table row with fewer cells than columns',
    create({ ...viewFor('table'), data: { columns: ['A', 'B'], rows: [['x', 'y'], ['z']] } }),
    'view.data.rows[1]',
    /^has 1 cell but there are 2 columns, so give every row exactly one cell per column$/,
  ],
  [
    'a timeline event with an invalid date',
    create({ ...viewFor('timeline'), data: { events: [{ at: '2026-02-31', title: 'Trip' }] } }),
    'view.data.events[0].at',
    /^must be a real date such as 2026-01-31 or a date-time with a timezone such as 2026-01-31T09:00:00Z \(use label for a period\)$/,
  ],
];

for (const [name, value, path, problem] of refusedShapes) {
  test(`explains ${name}`, () => {
    assert.equal(isWorkspaceCommand(value, options), false);
    const problems = explain(value);
    assert.equal(problems[0].path, path);
    assert.match(problems[0].problem, problem);
  });
}

test('create without viewId and view names both fields with a worked example for the view', () => {
  const problems = explain({ commandId: 'c1', operation: 'create' });
  assert.deepEqual(problems.map(({ path }) => path), ['viewId', 'view']);
  assert.match(problems[1].problem, /^is required, and must be a JSON object like \{"version":1,"title":"\.\.\.","renderer":"list"/);
});

const operationProblems = [
  ['navigate without a page', command({ operation: 'navigate' }), 'page'],
  ['navigate to an unknown page', command({ operation: 'navigate', page: 'nowhere' }), 'page'],
  ['a settings section on another page', command({ operation: 'navigate', page: 'usage', section: 'voice' }), 'section'],
  ['an unknown settings section', command({ operation: 'navigate', page: 'settings', section: 'nope' }), 'section'],
  ['a task id on another page', command({ operation: 'navigate', page: 'usage', taskId: '12' }), 'taskId'],
  ['a task id with a leading zero', command({ operation: 'navigate', page: 'factory', taskId: '012' }), 'taskId'],
  ['issue number zero', command({ operation: 'navigate', page: 'factory', issueNumber: 0 }), 'issueNumber'],
  ['conversation without an action', command({ operation: 'conversation' }), 'action'],
  ['conversation toggle', command({ operation: 'conversation', action: 'toggle' }), 'action'],
  ['an unsupported session language', command({ operation: 'session', action: 'language', value: 'fr' }), 'value'],
  ['an unsupported voice value', command({ operation: 'session', action: 'voice', value: 'start' }), 'value'],
  ['an unknown session action', command({ operation: 'session', action: 'dance', value: 'da' }), 'action'],
  ['a session action without a value', command({ operation: 'session', action: 'camera' }), 'value'],
  ['show without a viewId', command({ operation: 'show' }), 'viewId'],
  ['close with a bad viewId', command({ operation: 'close', viewId: '1st' }), 'viewId'],
  ['focus with a region', command({ operation: 'focus', viewId: 'v1', region: 'left' }), 'region'],
  ['place in an unknown region', command({ operation: 'place', viewId: 'v1', region: 'middle' }), 'region'],
  ['place without a region', command({ operation: 'place', viewId: 'v1' }), 'region'],
  ['an unknown arrange layout', command({ operation: 'arrange', layout: 'spiral' }), 'layout'],
  ['arrange with no view ids', command({ operation: 'arrange', layout: 'grid', viewIds: [] }), 'viewIds'],
  ['arrange with duplicate view ids', command({ operation: 'arrange', layout: 'grid', viewIds: ['v1', 'v1'] }), 'viewIds'],
  [
    'arrange with nine view ids',
    command({ operation: 'arrange', layout: 'grid', viewIds: Array.from({ length: 9 }, (_, index) => `v${index}`) }),
    'viewIds',
  ],
  ['close-all with a viewId', command({ operation: 'close-all', viewId: 'v1' }), 'viewId'],
  ['move with x out of range', command({ operation: 'move', viewId: 'v1', x: 2, y: 0.5 }), 'x'],
  ['move without y', command({ operation: 'move', viewId: 'v1', x: 0.5 }), 'y'],
  ['resize too narrow', command({ operation: 'resize', viewId: 'v1', width: 0.1, height: 0.5 }), 'width'],
  ['resize too tall', command({ operation: 'resize', viewId: 'v1', width: 0.5, height: 0.99 }), 'height'],
  ['resize with x leaving no room', command({ operation: 'resize', viewId: 'v1', width: 0.9, height: 0.5, x: 0.5 }), 'x'],
  ['resize with y leaving no room', command({ operation: 'resize', viewId: 'v1', width: 0.5, height: 0.9, y: 0.5 }), 'y'],
  ['resize without a width', command({ operation: 'resize', viewId: 'v1', height: 0.5 }), 'width'],
  ['an unknown layout arrangement', command({ operation: 'layout', arrangement: 'stacked' }), 'arrangement'],
  ['context-panel without an action', command({ operation: 'context-panel' }), 'action'],
  ['an unknown context-panel action', command({ operation: 'context-panel', action: 'peek' }), 'action'],
  [
    'context-panel close with a view',
    command({ operation: 'context-panel', action: 'close', view: cleanList() }),
    'view',
  ],
  [
    'context-panel open with a bad view',
    command({ operation: 'context-panel', action: 'open', view: { ...cleanList(), version: 2 } }),
    'view.version',
  ],
  ['an unknown target', command({ operation: 'close-all', target: 'tablet' }), 'target'],
  ['a commandId with a space', { commandId: 'a b', operation: 'close-all' }, 'commandId'],
  ['a missing commandId', { operation: 'close-all' }, 'commandId'],
  ['a commandId that is too long', { commandId: 'a'.repeat(129), operation: 'close-all' }, 'commandId'],
  ['an unknown operation', command({ operation: 'execute' }), 'operation'],
  ['a missing operation', command({}), 'operation'],
  ['an unexpected property', command({ operation: 'close-all', 'private-extra': 1 }), 'arguments'],
  ['text instead of an object', 'text', 'arguments'],
  ['an array instead of an object', [], 'arguments'],
  ['null instead of an object', null, 'arguments'],
];

for (const [name, value, path] of operationProblems) {
  test(`stays in step with isWorkspaceCommand for ${name}`, () => {
    assert.equal(isWorkspaceCommand(value, options), false);
    assert.ok(explain(value).some((problem) => problem.path === path), `expected a problem at ${path}`);
  });
}

const listBase = create(viewFor('list'));
const manyActions = Array.from({ length: 11 }, () => ({ type: 'open-route', route: '/usage' }));
const viewProblems = [
  ['version 2', listBase, ['view', 'version'], 2, 'view.version'],
  ['a missing version', listBase, ['view', 'version'], undefined, 'view.version'],
  ['an empty title', listBase, ['view', 'title'], '', 'view.title'],
  ['a title that is too long', listBase, ['view', 'title'], 'x'.repeat(201), 'view.title'],
  ['an unknown renderer', listBase, ['view', 'renderer'], 'carousel', 'view.renderer'],
  ['a missing source', listBase, ['view', 'source'], undefined, 'view.source'],
  ['an unknown source id', listBase, ['view', 'source', 'id'], 'gmail', 'view.source.id'],
  ['an unknown source status', listBase, ['view', 'source', 'status'], 'bogus', 'view.source.status'],
  ['a source reason that is too long', listBase, ['view', 'source', 'reason'], 'x'.repeat(501), 'view.source.reason'],
  ['an unexpected source property', listBase, ['view', 'source', 'extra'], 1, 'view.source'],
  [
    'an incoherent source page',
    listBase,
    ['view', 'source', 'page'],
    { limit: 0, offset: 0, nextOffset: null },
    'view.source.page',
  ],
  ['an unexpected view property', listBase, ['view', 'extra'], 1, 'view'],
  ['missing data', listBase, ['view', 'data'], undefined, 'view.data'],
  ['eleven actions', listBase, ['view', 'actions'], manyActions, 'view.actions'],
  [
    'a call-tool action for an unregistered tool',
    listBase,
    ['view', 'actions'],
    [{ type: 'call-tool', tool: 'nope' }],
    'view.actions[0].tool',
  ],
  [
    'a call-tool action with an invalid tool name',
    listBase,
    ['view', 'actions'],
    [{ type: 'call-tool', tool: 'no spaces' }],
    'view.actions[0].tool',
  ],
  [
    'a link on another host',
    listBase,
    ['view', 'actions'],
    [{ type: 'open-link', url: 'https://example.com/x', label: 'Go' }],
    'view.actions[0].url',
  ],
  [
    'a link with a port',
    listBase,
    ['view', 'actions'],
    [{ type: 'open-link', url: 'https://github.com:8443/x', label: 'Go' }],
    'view.actions[0].url',
  ],
  [
    'a link without a label',
    listBase,
    ['view', 'actions'],
    [{ type: 'open-link', url: 'https://github.com/x' }],
    'view.actions[0].label',
  ],
  ['a route outside the app', listBase, ['view', 'actions'], [{ type: 'open-route', route: '/nope' }], 'view.actions[0].route'],
  ['an unknown action type', listBase, ['view', 'actions'], [{ type: 'teleport' }], 'view.actions[0].type'],
  ['an incomplete window action', listBase, ['view', 'actions'], [{ type: 'window' }], 'view.actions[0]'],
  ['an action that is text', listBase, ['view', 'actions'], ['text'], 'view.actions[0]'],
  ['a view that is JSON text', listBase, ['view'], JSON.stringify(viewFor('list')), 'view'],
  ['a view that is an array', listBase, ['view'], [], 'view'],
  [
    'a view larger than 256 KiB',
    listBase,
    ['view', 'data', 'items'],
    Array.from({ length: 200 }, () => ({ title: 't', description: 'x'.repeat(2_000) })),
    'view',
  ],
  ['a table without columns', create(viewFor('table')), ['view', 'data', 'columns'], [], 'view.data.columns'],
  ['a table row with too few cells', create(viewFor('table')), ['view', 'data', 'rows', 0], ['only one'], 'view.data.rows[0]'],
  ['a table row with too many cells', create(viewFor('table')), ['view', 'data', 'rows', 1], [1, 2, 3], 'view.data.rows[1]'],
  ['a table cell that is an object', create(viewFor('table')), ['view', 'data', 'rows', 0], [{}, 1], 'view.data.rows[0][0]'],
  ['table data with an unexpected key', create(viewFor('table')), ['view', 'data', 'extra'], [], 'view.data'],
  ['a list item without a title', create(viewFor('list')), ['view', 'data', 'items', 0, 'title'], '', 'view.data.items[0].title'],
  [
    'a list item with a call-tool action',
    create(viewFor('list')),
    ['view', 'data', 'items', 0, 'action'],
    { type: 'call-tool', tool: 'mail_search' },
    'view.data.items[0].action.type',
  ],
  ['a list item with an unexpected key', create(viewFor('list')), ['view', 'data', 'items', 0, 'extra'], 1, 'view.data.items[0]'],
  [
    'a list item with eleven details',
    create(viewFor('list')),
    ['view', 'data', 'items', 0, 'details'],
    Array.from({ length: 11 }, () => ({ label: 'l', value: 'v' })),
    'view.data.items[0].details',
  ],
  [
    'a list item link on another host',
    create(viewFor('list')),
    ['view', 'data', 'items', 0, 'action'],
    { type: 'open-link', url: 'https://example.com', label: 'Go' },
    'view.data.items[0].action.url',
  ],
  ['a detail field without a label', create(viewFor('detail')), ['view', 'data', 'fields', 0, 'label'], '', 'view.data.fields[0].label'],
  ['text with an unknown format', create(viewFor('text')), ['view', 'data', 'format'], 'html', 'view.data.format'],
  ['text that is too long', create(viewFor('text')), ['view', 'data', 'content'], 'x'.repeat(10_001), 'view.data.content'],
  ['a timeline date that does not exist', create(viewFor('timeline')), ['view', 'data', 'events', 0, 'at'], '2026-02-31', 'view.data.events[0].at'],
  ['a timeline event without at or label', create(viewFor('timeline')), ['view', 'data', 'events', 0], { title: 'x' }, 'view.data.events[0]'],
  ['a timeline label that is too long', create(viewFor('timeline')), ['view', 'data', 'events', 2, 'label'], 'x'.repeat(41), 'view.data.events[2].label'],
  ['an unknown chart kind', create(viewFor('chart')), ['view', 'data', 'kind'], 'pie', 'view.data.kind'],
  ['a chart without series', create(viewFor('chart')), ['view', 'data', 'series'], [], 'view.data.series'],
  ['a chart point with a text y', create(viewFor('chart')), ['view', 'data', 'series', 0, 'points', 0, 'y'], 'high', 'view.data.series[0].points[0]'],
  ['a task card without a state', create(viewFor('task-card')), ['view', 'data', 'state'], '', 'view.data.state'],
  ['a status with an unknown state', create(viewFor('status')), ['view', 'data', 'state'], 'fine', 'view.data.state'],
  ['an image on another host', create(viewFor('image')), ['view', 'data', 'images', 0, 'url'], 'https://example.com/a.png', 'view.data.images[0].url'],
  ['an image without alt text', create(viewFor('image')), ['view', 'data', 'images', 0, 'alt'], '', 'view.data.images[0].alt'],
  ['an html-app with a bad artifact id', create(viewFor('html-app')), ['view', 'data', 'artifactId'], 'not-an-id', 'view.data.artifactId'],
  ['a knowledge-graph with a blank query', create(viewFor('knowledge-graph')), ['view', 'data', 'query'], '   ', 'view.data.query'],
  [
    'a knowledge-graph with duplicate highlights',
    create(viewFor('knowledge-graph')),
    ['view', 'data', 'highlight'],
    ['a'.repeat(64), 'a'.repeat(64)],
    'view.data.highlight',
  ],
  ['code with too many lines', create(viewFor('code')), ['view', 'data', 'content'], 'x\n'.repeat(401), 'view.data'],
  ['table data replaced by text', create(viewFor('table')), ['view', 'data'], 'text', 'view.data'],
  ['list data shaped like another renderer', create(viewFor('list')), ['view', 'data'], { format: 'plain', content: 'x' }, 'view.data'],
];

for (const [name, base, path, value, expected] of viewProblems) {
  test(`stays in step with isWorkspaceCommand for ${name}`, () => {
    const mutated = mutate(base, path, value);
    assert.equal(isWorkspaceCommand(mutated, options), false);
    assert.ok(explain(mutated).some((problem) => problem.path === expected), `expected a problem at ${expected}`);
  });
}

test('enumerations in the explanations are the ones of the tool schema', () => {
  const operations = workspaceCommandSchema.properties.operation.enum;
  const unknownOperation = workspaceCommandProblems({ commandId: 'c1', operation: 'nope' })[0];
  assert.deepEqual(
    unknownOperation.problem.replace(/^must be one of /, '').split(/, | or /).sort(),
    [...operations].sort(),
  );
  const sourceIds = generatedViewSchema.oneOf[0].properties.source.properties.id.enum;
  const unknownSource = explain(create({ ...cleanList(), source: { id: 'gmail', status: 'complete' } }))[0];
  assert.deepEqual(
    unknownSource.problem.replace(/^must be one of /, '').replace(/ \(use now.*$/, '').split(/, | or /).sort(),
    [...sourceIds].sort(),
  );
  const renderers = explain(create({ ...cleanList(), renderer: 'carousel' }))[0];
  assert.deepEqual(renderers.problem.replace(/^must be one of /, '').split(/, | or /).sort(), [...generatedViewRenderers].sort());
});

test('flags what the tool schema refuses even though isWorkspaceCommand accepts it', () => {
  const running = mutate(create(viewFor('list')), ['view', 'source', 'status'], 'running');
  assert.equal(isWorkspaceCommand(running, options), true);
  assert.equal(explain(running)[0].path, 'view.source.status');
  const dateOnly = mutate(create(viewFor('list')), ['view', 'source', 'updatedAt'], '2026-01-31');
  assert.equal(isWorkspaceCommand(dateOnly, options), true);
  assert.equal(explain(dateOnly)[0].path, 'view.source.updatedAt');
});

test('checks call-tool names against the registry only when a registry is supplied', () => {
  const value = create({ ...cleanList(), actions: [{ type: 'call-tool', tool: 'unknown_tool' }] });
  assert.equal(isWorkspaceCommand(value), true);
  assert.deepEqual(workspaceCommandProblems(value), []);
  assert.equal(isWorkspaceCommand(value, { registeredTools }), false);
  assert.equal(explain(value, { registeredTools })[0].path, 'view.actions[0].tool');
  const registered = create({ ...cleanList(), actions: [{ type: 'call-tool', tool: 'mail_search' }] });
  assert.deepEqual(workspaceCommandProblems(registered, { registeredTools }), []);
});

test('accepts the trusted image storage host only when it is supplied', () => {
  const value = create({
    ...viewFor('image'),
    data: { images: [{ url: 'https://jarvisblob.blob.core.windows.net/a.png', alt: 'A' }] },
  });
  assert.equal(isWorkspaceCommand(value), false);
  assert.equal(explain(value, {})[0].path, 'view.data.images[0].url');
  assert.equal(isWorkspaceCommand(value, options), true);
  assert.deepEqual(workspaceCommandProblems(value, options), []);
});

test('reports at most three problems so a refusal fits one message', () => {
  const messy = {
    commandId: 'a b', target: 'x', operation: 'move', viewId: '1', x: 5, y: 5, region: 'left', 'private-key': 1,
  };
  assert.equal(explain(messy).length, 3);
});

const marker = 'private-secret-value';
const leakyPayloads = [
  { commandId: marker, operation: marker },
  create(cleanList(), { target: marker }),
  create(cleanList(), { [marker]: marker }),
  { commandId: 'c1', operation: 'move', viewId: marker, x: marker, y: marker },
  { commandId: 'c1', operation: 'navigate', page: marker, section: marker, taskId: marker, issueNumber: marker },
  { commandId: 'c1', operation: 'session', action: marker, value: marker },
  { commandId: 'c1', operation: 'session', action: 'language', value: marker },
  { commandId: 'c1', operation: 'conversation', action: marker },
  { commandId: 'c1', operation: 'place', viewId: 'v1', region: marker },
  { commandId: 'c1', operation: 'arrange', layout: marker, viewIds: [marker, marker] },
  { commandId: 'c1', operation: 'context-panel', action: marker, view: marker },
  create(marker),
  create({
    ...cleanList(), [marker]: marker, version: marker, title: marker.repeat(20), renderer: marker, source: marker, data: marker, actions: marker,
  }),
  create({
    ...cleanList(),
    source: { id: marker, status: marker, updatedAt: marker, reason: marker.repeat(40), page: marker, [marker]: marker },
  }),
  create({
    ...cleanList(),
    data: { items: [{ title: marker.repeat(20), description: 5, details: marker, action: { type: marker } }, { [marker]: marker }] },
  }),
  create({
    ...cleanList(),
    actions: [
      { type: 'call-tool', tool: marker },
      { type: 'open-link', url: `https://${marker}.example.com`, label: marker },
      { type: 'open-route', route: marker },
      { type: 'window', windowId: marker, operation: marker },
      { type: marker },
      marker,
    ],
  }),
  create({ ...viewFor('table'), data: { columns: [marker], rows: [[marker], [marker, marker], marker] } }),
  create({ ...viewFor('timeline'), data: { events: [{ at: marker, label: marker.repeat(5), title: marker, [marker]: 1 }] } }),
  create({ ...viewFor('chart'), data: { kind: marker, series: [{ name: marker, points: [{ x: {}, y: marker }] }] } }),
  create({ ...viewFor('image'), data: { images: [{ url: `https://${marker}.example.com/a.png`, alt: marker.repeat(40) }] } }),
  create({ ...viewFor('status'), data: { label: marker.repeat(20), state: marker, value: 1 } }),
  create({ ...viewFor('task-card'), data: { id: marker.repeat(5), title: 1, state: marker } }),
  create({ ...viewFor('html-app'), data: { artifactId: marker } }),
  create({ ...viewFor('knowledge-graph'), data: { query: marker, highlight: [marker] } }),
  create({ ...viewFor('code'), data: { repo: marker, path: marker, content: marker, startLine: marker } }),
];

test('never repeats a value or an unknown property name from the command', () => {
  for (const value of leakyPayloads) {
    assert.equal(isWorkspaceCommand(value, options), false);
    const problems = explain(value);
    assert.ok(problems.length > 0, JSON.stringify(value).slice(0, 120));
    const text = JSON.stringify(problems);
    assert.ok(!text.includes('private') && !text.includes('secret'), text);
  }
});

test('never throws on hostile input', () => {
  const circular = {};
  circular.self = circular;
  for (const value of [
    undefined, null, [], 'text', 42, true, {}, { operation: {} }, { commandId: 'c1', operation: ['create'] },
    create(circular), create({ version: 1n }),
    create({ ...cleanList(), data: { items: [null, 1, 'x', [], undefined] } }),
    JSON.parse('{"__proto__":{"operation":"create"},"commandId":"c1","operation":"constructor"}'),
  ]) {
    assert.doesNotThrow(() => workspaceCommandProblems(value, options));
  }
});
