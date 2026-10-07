import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generatedViewActionTypes,
  generatedViewRenderers,
  generatedViewSchema,
  htmlArtifactByteLimit,
  htmlArtifactFrameSchema,
  htmlArtifactSchema,
  isHtmlArtifact,
  isHtmlArtifactFrame,
  isModelCatalogue,
  modelCapabilities,
  modelRoles,
  reasoningEfforts,
  isGeneratedView,
  isValidHtmlArtifactHtml,
  isJarvisActivityEvent,
  isJarvisVoiceWakeEvent,
  isBackgroundJob,
  isBackgroundJobEvent,
  isWebResearchResult,
  isWorkspaceCommand,
  generatedViewVersion,
  workspaceCommandSchema,
  webResearchResultSchema,
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

test('model catalogue contracts restrict roles, capabilities and reasoning efforts', () => {
  assert.deepEqual(modelRoles, ['chat', 'vision', 'research', 'voice', 'transcription', 'embedding', 'codex', 'copilot']);
  assert.deepEqual(reasoningEfforts, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(modelCapabilities, ['chat', 'responses', 'realtime', 'transcription', 'embeddings', 'image']);
  const catalogue = {
    source: 'arm',
    deployments: [{
      name: 'gpt-6-luna',
      model: 'gpt-6-luna',
      version: '2026-09-22',
      sku: 'GlobalStandard',
      capacity: 50,
      capabilities: ['chat', 'responses', 'image'],
      reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    }],
  };
  assert.equal(isModelCatalogue(catalogue), true);
  assert.equal(isModelCatalogue({ ...catalogue, source: 'live' }), false);
  assert.equal(isModelCatalogue({
    ...catalogue,
    deployments: [{ ...catalogue.deployments[0], reasoningEfforts: ['unbounded'] }],
  }), false);
});

test('renderer and action identifiers match the JSON schema allowlists', () => {
  assert.deepEqual(generatedViewSchema.oneOf.map((schema) => schema.properties.renderer.const), generatedViewRenderers);
  assert.deepEqual(generatedViewActionTypes, ['open-route', 'open-link', 'call-tool', 'window']);
  assert.equal(new Set(generatedViewRenderers).size, generatedViewRenderers.length);
});

test('accepts only bounded Jarvis activity fields and known outcomes', () => {
  const activityId = '12345678-1234-4234-8234-123456789abc';
  assert.equal(isJarvisActivityEvent({ type: 'listening', activityId, source: 'voice' }), true);
  assert.equal(isJarvisActivityEvent({
    type: 'tool-call-started', activityId, source: 'chat', toolName: 'list_tasks',
  }), true);
  assert.equal(isJarvisActivityEvent({
    type: 'tool-call-finished', activityId, source: 'voice', toolName: 'list_tasks', outcome: 'refused',
  }), true);
  assert.equal(isJarvisActivityEvent({
    type: 'tool-call-finished', activityId, source: 'voice', toolName: 'list_tasks', outcome: 'error',
  }), true);
  assert.equal(isJarvisActivityEvent({
    type: 'tool-call-finished', activityId, source: 'chat', toolName: 'list_tasks', outcome: 'ok',
  }), true);
});

test('accepts only a bounded voice wake event with a canonical UTC timestamp', () => {
  assert.equal(isJarvisVoiceWakeEvent({ type: 'voice.wake', at: '2026-10-06T14:24:37.078Z' }), true);
  assert.equal(isJarvisVoiceWakeEvent({ type: 'voice.wake', at: '2026-13-06T14:24:37.078Z' }), false);
  assert.equal(isJarvisVoiceWakeEvent({ type: 'voice.wake', at: '2026-10-06T14:24:37Z' }), false);
  assert.equal(isJarvisVoiceWakeEvent({ type: 'voice.wake', at: '2026-10-06T14:24:37.078Z', audio: 'x' }), false);
  assert.equal(isJarvisVoiceWakeEvent({ type: 'listening', at: '2026-10-06T14:24:37.078Z' }), false);
  assert.equal(isJarvisActivityEvent({ type: 'voice.wake', at: '2026-10-06T14:24:37.078Z' }), false);
});

test('web research result schema and validator accept bounded source-linked results', () => {
  const result = {
    answer: 'A sourced answer.',
    sources: [{
      title: 'Example source',
      url: 'https://example.com/research',
      retrievedAt: '2026-10-05T07:32:00.000Z',
    }],
  };
  assert.deepEqual(webResearchResultSchema.required, ['answer', 'sources']);
  assert.equal(isWebResearchResult(result), true);
  assert.equal(isWebResearchResult({ ...result, sources: [] }), true);
  assert.equal(isWebResearchResult({ ...result, answer: 'a'.repeat(20_001) }), false);
  assert.equal(isWebResearchResult({
    ...result,
    sources: [{ ...result.sources[0], url: 'http://example.com/research' }],
  }), false);
  assert.equal(isWebResearchResult({
    ...result,
    sources: [{ ...result.sources[0], retrievedAt: 'October 5, 2026' }],
  }), false);
  assert.equal(isWebResearchResult({
    ...result,
    sources: [result.sources[0], result.sources[0]],
  }), false);
});

test('HTML artifacts and frames enforce the shared bounded security contract', () => {
  const artifact = {
    id: '12345678-1234-4234-8234-123456789abc',
    kind: 'html',
    title: 'Research report',
    html: '<!doctype html><h1>Findings</h1><script>parent.postMessage({type:"pin"},"*")</script>',
    sources: [{ title: 'Primary source', url: 'https://example.com/report' }],
    createdAt: '2026-10-06T11:00:00.000Z',
    pinned: false,
  };
  const frame = {
    widthPx: 640,
    heightPx: 480,
    device: 'desktop',
    theme: 'dark',
    reducedMotion: false,
    density: 'comfortable',
    designTokens: { '--surface': '#101721', '--text': '#f3fff9' },
    fonts: { body: 'system-ui, sans-serif', heading: 'system-ui, sans-serif', mono: 'monospace' },
    layout: 'tiled',
    pinned: false,
  };

  assert.deepEqual(htmlArtifactSchema.required, ['id', 'kind', 'title', 'html', 'sources', 'createdAt', 'pinned']);
  assert.deepEqual(htmlArtifactFrameSchema.required, Object.keys(frame));
  assert.equal(isHtmlArtifact(artifact), true);
  assert.equal(isValidHtmlArtifactHtml('é'.repeat(htmlArtifactByteLimit / 2)), true);
  assert.equal(isValidHtmlArtifactHtml('é'.repeat(htmlArtifactByteLimit / 2 + 1)), false);
  assert.equal(isValidHtmlArtifactHtml('<script src="https://example.com/x.js"></script>'), false);
  assert.equal(isValidHtmlArtifactHtml('<base href="https://example.com/">'), false);
  assert.equal(isHtmlArtifact({ ...artifact, sources: Array.from({ length: 51 }, () => artifact.sources[0]) }), false);
  assert.equal(isHtmlArtifact({
    ...artifact, sources: [{ title: 'Unsafe', url: 'https://user@example.com/report' }],
  }), false);
  assert.equal(isHtmlArtifact({ ...artifact, createdAt: 'October 6, 2026' }), false);
  assert.equal(isHtmlArtifactFrame(frame), true);
  assert.equal(isHtmlArtifactFrame({ ...frame, designTokens: { 'background-image': 'url(https://evil)' } }), false);
  assert.equal(isHtmlArtifactFrame({ ...frame, widthPx: Number.POSITIVE_INFINITY }), false);
});

test('rejects malformed activity and any extra payload that could carry private data', () => {
  const activity = { type: 'thinking', activityId: '12345678-1234-4234-8234-123456789abc', source: 'chat' };
  assert.equal(isJarvisActivityEvent({ ...activity, message: 'private transcript' }), false);
  assert.equal(isJarvisActivityEvent({ ...activity, activityId: 'not-an-id' }), false);
  assert.equal(isJarvisActivityEvent({ ...activity, source: 'agent' }), false);
  assert.equal(isJarvisActivityEvent({
    type: 'tool-call-finished', activityId: activity.activityId, source: 'chat',
    toolName: 'list_tasks', outcome: 'unknown',
  }), false);
  assert.equal(isJarvisActivityEvent({
    type: 'tool-call-started', activityId: activity.activityId, source: 'chat',
    toolName: 'list_tasks', arguments: { secret: 'must not pass' },
  }), false);
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
    { renderer: 'html-app', data: { artifactId: '12345678-1234-4234-8234-123456789abc' } },
    {
      renderer: 'knowledge-graph',
      source: { id: 'knowledge_graph', status: 'complete', updatedAt: '2026-10-07T12:00:00Z' },
      data: { query: 'project notes', highlight: ['a'.repeat(64)] },
    },
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

test('accepts HTML app views only as references to bounded UUID artifacts', () => {
  const view = {
    version: generatedViewVersion,
    title: 'Research app',
    renderer: 'html-app',
    source: { id: 'html_generation', status: 'complete' },
    data: { artifactId: '56a2b0bd-af47-46b5-8e15-c6e9a718ae93' },
  };
  assert.equal(isGeneratedView(view), true);
  assert.equal(isGeneratedView({ ...view, data: { artifactId: 'not-an-id' } }), false);
  assert.equal(isGeneratedView({ ...view, data: { ...view.data, html: '<script>alert(1)</script>' } }), false);
});

test('rejects malformed, unsupported, extra-field, and invalid-action payloads', () => {
  assert.equal(isGeneratedView(listView({ data: { items: [{ title: 42 }] } })), false);
  assert.equal(isGeneratedView(listView({ version: 2 })), false);
  assert.equal(isGeneratedView(listView({ renderer: 'script' })), false);
  assert.equal(isGeneratedView(listView({
    renderer: 'knowledge-graph',
    source: { id: 'knowledge_graph', status: 'complete' },
    data: { query: '   ', highlight: [] },
  })), false);
  assert.equal(isGeneratedView(listView({
    renderer: 'knowledge-graph',
    source: { id: 'knowledge_graph', status: 'complete' },
    data: { query: 'graph', highlight: ['invalid'] },
  })), false);
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

test('defines and validates bounded workspace commands for the approved operations', () => {
  const base = { commandId: 'cmd-1' };
  const commands = [
    { ...base, operation: 'create', viewId: 'research', view: listView() },
    { ...base, operation: 'update', viewId: 'research', view: listView() },
    ...['show', 'close', 'minimise', 'restore', 'focus'].map((operation) => ({
      ...base, operation, viewId: 'research',
    })),
    { ...base, operation: 'move', viewId: 'research', x: 0.1, y: 0.2 },
    { ...base, operation: 'resize', viewId: 'research', width: 0.6, height: 0.5, x: 0.1, y: 0.2 },
    { ...base, operation: 'layout', arrangement: 'layered' },
    { ...base, operation: 'context-panel', action: 'open', view: listView() },
    { ...base, operation: 'context-panel', action: 'open' },
    ...['close', 'toggle'].map((action) => ({ ...base, operation: 'context-panel', action })),
  ];

  assert.equal(workspaceCommandSchema.oneOf.length, 13);
  for (const command of commands) assert.equal(isWorkspaceCommand(command), true, command.operation);
});

test('rejects invalid workspace IDs, geometry, operations, and generated-view allowlists', () => {
  const command = { commandId: 'cmd-1', operation: 'move', viewId: 'research', x: 0.1, y: 0.2 };
  assert.equal(isWorkspaceCommand({ ...command, viewId: '../settings' }), false);
  assert.equal(isWorkspaceCommand({ ...command, commandId: 'cmd bad' }), false);
  assert.equal(isWorkspaceCommand({ ...command, operation: 'execute' }), false);
  assert.equal(isWorkspaceCommand({ ...command, x: Number.NaN }), false);
  assert.equal(isWorkspaceCommand({ ...command, x: -0.1 }), false);
  assert.equal(isWorkspaceCommand({ ...command, y: 1.1 }), false);
  assert.equal(isWorkspaceCommand({
    commandId: 'cmd-2', operation: 'resize', viewId: 'research', width: 0.2, height: 0.5,
  }), false);
  assert.equal(isWorkspaceCommand({
    commandId: 'cmd-3', operation: 'resize', viewId: 'research', width: 0.92, height: 0.8, x: 0.1,
  }), false);
  assert.equal(isWorkspaceCommand({
    commandId: 'cmd-4', operation: 'layout', arrangement: 'script',
  }), false);
  assert.equal(isWorkspaceCommand({
    commandId: 'cmd-5', operation: 'create', viewId: 'research', view: listView({ renderer: 'script' }),
  }), false);
  assert.equal(isWorkspaceCommand({
    commandId: 'cmd-6', operation: 'context-panel', action: 'open', view: listView({
      actions: [{ type: 'call-tool', tool: 'unknown_tool' }],
    }),
  }, { registeredTools: ['list_tasks'] }), false);
});

test('background jobs are bounded and typed', () => {
  const job = {
    jobId: '11111111-1111-4111-8111-111111111111',
    kind: 'research',
    title: 'Research: Microsoft Foundry IQ',
    status: 'running',
    step: 1,
    steps: 3,
    detail: 'Searching: Key findings',
    startedAt: '2026-10-07T12:00:00.000Z',
    updatedAt: '2026-10-07T12:00:05.000Z',
  };
  assert.equal(isBackgroundJob(job), true);
  assert.equal(isBackgroundJob({ ...job, kind: 'embedding' }), true);
  assert.equal(isBackgroundJob({ ...job, status: 'done', step: 3, viewId: 'research-abc' }), true);
  assert.equal(isBackgroundJob({ ...job, step: 4 }), false);
  assert.equal(isBackgroundJob({ ...job, title: 'x'.repeat(81) }), false);
  assert.equal(isBackgroundJob({ ...job, kind: 'shell' }), false);
  assert.equal(isBackgroundJob({ ...job, viewId: '../etc' }), false);
  assert.equal(isBackgroundJob({ ...job, extra: true }), false);
  assert.equal(isBackgroundJobEvent({ type: 'job', job }), true);
  assert.equal(isBackgroundJobEvent({ type: 'job', job, more: 1 }), false);
});
