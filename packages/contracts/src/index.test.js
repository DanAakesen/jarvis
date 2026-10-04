import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generatedViewActionTypes,
  generatedViewRenderers,
  generatedViewSchema,
  isGeneratedView,
  generatedViewVersion,
} from './index.js';

const source = { id: 'factory.tasks', status: 'complete' };
const listView = (overrides = {}) => ({
  version: generatedViewVersion,
  title: 'Running tasks',
  renderer: 'list',
  source,
  data: { items: [{ title: 'Ship the contract', details: [{ label: 'Project', value: 'Jarvis' }] }] },
  ...overrides,
});

test('renderer and action identifiers match the JSON schema allowlists', () => {
  assert.deepEqual(generatedViewSchema.oneOf.map((schema) => schema.properties.renderer.const), generatedViewRenderers);
  assert.deepEqual(generatedViewActionTypes, ['open-route', 'open-link', 'call-tool', 'window']);
  assert.equal(new Set(generatedViewRenderers).size, generatedViewRenderers.length);
});

test('accepts bounded declarative views from complete, partial and unavailable sources', () => {
  assert.equal(isGeneratedView(listView()), true);
  assert.equal(isGeneratedView(listView({
    source: { id: 'factory.tasks', status: 'partial', reason: 'More tasks are available.', page: {
      limit: 50, offset: 50, total: 140, nextOffset: 100,
    } },
  })), true);
  assert.equal(isGeneratedView(listView({
    source: { id: 'now', status: 'unavailable', reason: 'The source is unavailable.' },
    data: { items: [] },
  })), true);
});

test('accepts each allowlisted renderer and action without interpreting its content', () => {
  const views = [
    { renderer: 'table', data: { columns: ['Name'], rows: [['<b>Task</b>']] } },
    { renderer: 'list', data: { items: [{ title: 'Task' }] } },
    { renderer: 'detail', data: { fields: [{ label: 'State', value: 'Running' }] } },
    { renderer: 'text', data: { format: 'markdown', content: '<script>not executed</script>' } },
    { renderer: 'timeline', data: { events: [{ at: '2026-10-04T00:00:00Z', title: 'Started' }] } },
    { renderer: 'chart', data: { kind: 'line', series: [{ name: 'Usage', points: [{ x: 'today', y: 2 }] }] } },
    { renderer: 'task-card', data: { id: '42', title: 'Task', state: 'Running' } },
    { renderer: 'status', data: { label: 'Backend', state: 'ok' } },
    { renderer: 'image', data: { images: [{ url: 'https://github.com/example/task.png', alt: 'Task' }] } },
  ];
  for (const view of views) assert.equal(isGeneratedView(listView(view)), true, view.renderer);
  assert.equal(isGeneratedView(listView({
    actions: [
      { type: 'open-route', route: '/settings' },
      { type: 'open-route', route: '/factory/tasks/9223372036854775807' },
      { type: 'open-link', url: 'https://management.azure.com/', label: 'Azure' },
      { type: 'call-tool', tool: 'list_tasks' },
      { type: 'window', operation: 'move', windowId: 'view-1', x: 10, y: 20 },
      { type: 'window', operation: 'resize', windowId: 'view-1', width: 500, height: 300 },
    ],
  })), true);
  assert.equal(isGeneratedView(listView({
    actions: [{ type: 'window', operation: 'move', windowId: 'view-1' }],
  })), false);
  assert.equal(isGeneratedView(listView({
    actions: [{ type: 'call-tool', tool: 'not_registered' }],
  }), { registeredTools: ['list_tasks'] }), false);
});

test('rejects malformed, unsupported, extra-field, and invalid-action payloads', () => {
  assert.equal(isGeneratedView(listView({ data: { items: [{ title: 42 }] } })), false);
  assert.equal(isGeneratedView(listView({ version: 2 })), false);
  assert.equal(isGeneratedView(listView({ renderer: 'script' })), false);
  assert.equal(isGeneratedView({ ...listView(), extra: true }), false);
  assert.equal(isGeneratedView(listView({ actions: [{ type: 'open-route', route: '//evil.example' }] })), false);
  assert.equal(isGeneratedView(listView({
    actions: [{ type: 'open-route', route: '/factory/tasks/9223372036854775808' }],
  })), false);
  assert.equal(isGeneratedView(listView({ actions: [{ type: 'open-link', url: 'javascript:alert(1)', label: 'Open' }] })), false);
  assert.equal(isGeneratedView(listView({ actions: [{ type: 'call-tool', tool: 'unregistered tool' }] })), false);
});

test('bounds result rows, payload bytes, chart points, images and page metadata', () => {
  assert.equal(isGeneratedView(listView({
    data: { items: Array.from({ length: 501 }, (_, index) => ({ title: `Task ${index}` })) },
  })), false);
  assert.equal(isGeneratedView(listView({
    data: { items: Array.from({ length: 200 }, () => ({ title: 'x'.repeat(2_000) })) },
  })), false);
  assert.equal(isGeneratedView({
    ...listView(),
    renderer: 'chart',
    data: { kind: 'line', series: Array.from({ length: 2 }, (_, index) => ({
      name: `Series ${index}`,
      points: Array.from({ length: 501 }, (_, point) => ({ x: point, y: point })),
    })) },
  }), false);
  assert.equal(isGeneratedView({
    ...listView(),
    renderer: 'image',
    data: { images: Array.from({ length: 11 }, (_, index) => ({ url: `https://github.com/${index}`, alt: 'image' })) },
  }), false);
  assert.equal(isGeneratedView(listView({
    source: { id: 'factory.tasks', status: 'partial', page: { limit: 1_001, offset: 0, nextOffset: null } },
  })), false);
});

test('allows images only on GitHub hosts or the configured Jarvis Blob host', () => {
  const view = {
    ...listView(),
    renderer: 'image',
    data: { images: [{ url: 'https://jarvisdata.blob.core.windows.net/images/task.png', alt: 'Task' }] },
  };
  assert.equal(isGeneratedView(view), false);
  assert.equal(isGeneratedView(view, { trustedBlobHost: 'jarvisdata.blob.core.windows.net' }), true);
  assert.equal(isGeneratedView(view, { trustedBlobHost: 'other.blob.core.windows.net' }), false);
});
