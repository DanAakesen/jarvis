import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import {
  generatedViewActionTypes,
  generatedViewRenderers,
  generatedViewSchema,
  generatedCodeDataSchema,
  isGeneratedCodeData,
  isJarvisWorkActivityDetail,
  jarvisWorkActivityKinds,
  jarvisWorkActivityDetailSchema,
  folioKinds,
  folioItemSchema,
  folioSearchResponseSchema,
  isFolioItem,
  htmlArtifactByteLimit,
  htmlArtifactFrameSchema,
  htmlArtifactSchema,
  isHtmlArtifact,
  isHtmlArtifactFrame,
  isModelCatalogue,
  modelCapabilities,
  modelRoles,
  homeLocationSettingsSchema,
  memorySettingsBounds,
  memorySettingsSchema,
  reasoningEfforts,
  researchDepths,
  researchSettingsBounds,
  researchSettingsSchema,
  timeoutSettingsBounds,
  timeoutSettingsSchema,
  routineNameMaxLength,
  routineNameSchema,
  routineUpdateSchema,
  voiceTuningSettingsBounds,
  voiceTuningSettingsSchema,
  isGeneratedView,
  isValidHtmlArtifactHtml,
  isJarvisActivityEvent,
  isJarvisVoiceWakeEvent,
  isNowSseEvent,
  isTaskEventMessage,
  isTaskEventRecord,
  isTaskEventStreamEvent,
  isBackgroundJob,
  isBackgroundJobDetails,
  isBackgroundJobEvent,
  isBackgroundJobStep,
  isWebResearchResult,
  isWorkspaceCommand,
  isWorkspaceSnapshot,
  isWorkspaceView,
  generatedViewVersion,
  nowSseEventNames,
  workspaceCommandSchema,
  workspaceNavigationPages,
  workspaceSettingsSections,
  webResearchResultSchema,
  clipboardTextMaxBytes,
  isClipboardText,
  isClipboardReadResult,
  isClipboardWriteResult,
  isSystemSmokeStatus,
  systemSmokeCheckIds,
  factoryBoardColumnIds,
  isFactoryBoard,
  isFactoryBoardUpdate,
  isPresenceState,
  presenceModes,
  presenceSources,
  presenceStateSchema,
  presenceUpdateSchema,
} from './index.js';

test('workspace snapshots accept old clients and validate optional current and previous views', () => {
  const snapshot = { windows: [{ viewId: 'report', title: 'Report' }], contextPanelOpen: false };
  assert.equal(isWorkspaceSnapshot(snapshot), true);
  assert.equal(isWorkspaceSnapshot({
    ...snapshot,
    windows: [{
      ...snapshot.windows[0], state: 'minimised', placement: 'region', region: 'left',
      pinned: true, front: false,
    }],
  }), true);
  assert.equal(isWorkspaceSnapshot({ ...snapshot, windows: [{ ...snapshot.windows[0], region: 'left' }] }), false);
  assert.equal(isWorkspaceSnapshot({
    ...snapshot, windows: [{ ...snapshot.windows[0], placement: 'manual', region: 'left' }],
  }), false);
  assert.equal(isWorkspaceSnapshot({
    ...snapshot, windows: [{ ...snapshot.windows[0], state: 'closed' }],
  }), false);
  for (const page of workspaceNavigationPages) {
    assert.equal(isWorkspaceSnapshot({ ...snapshot, view: { page } }), true);
  }
  const view = {
    page: 'factory', taskId: '10', issueNumber: 587, focusedViewId: 'report', folioOpen: true,
    previous: { page: 'settings', section: 'voice' },
  };
  assert.equal(isWorkspaceSnapshot({ ...snapshot, view }), true);
  for (const invalid of [
    { page: 'unknown' }, { page: 'home', section: 'voice' },
    { page: 'settings', section: 'unknown' }, { page: 'home', taskId: '10' },
    { page: 'factory', taskId: '../10' }, { page: 'factory', issueNumber: 0 },
    { page: 'factory', issueNumber: Number.MAX_SAFE_INTEGER + 1 },
    { page: 'home', folioOpen: 'true' }, { page: 'home', focusedViewId: '../report' },
    { page: 'home', previous: { page: 'home', previous: { page: 'factory' } } },
    { page: 'home', previous: { page: 'factory', issueNumber: -1 } },
  ]) {
    assert.equal(isWorkspaceView(invalid), false, JSON.stringify(invalid));
    assert.equal(isWorkspaceSnapshot({ ...snapshot, view: invalid }), false);
  }
  assert.equal(isWorkspaceSnapshot({ ...snapshot, windows: Array(33).fill(snapshot.windows[0]) }), false);
  assert.equal(isWorkspaceSnapshot({ ...snapshot, frame: {} }), false);
});

const source = { id: 'factory.tasks', status: 'complete' };
const listView = (overrides = {}) => ({
  version: generatedViewVersion,
  title: 'Running tasks',
  renderer: 'list',
  source,
  data: { items: [{ title: 'Ship the contract', details: [{ label: 'Project', value: 'Jarvis' }] }] },
  ...overrides,
});

test('timeline schema and validator accept precise dates and ordered period labels', async () => {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  app.post('/', { schema: { body: generatedViewSchema } }, async () => ({}));
  const validate = async (payload) => (await app.inject({ method: 'POST', url: '/', payload })).statusCode === 200;
  try {
    for (const event of [
      { at: '1880-11-13' },
      { at: '2026-09-29' },
      { at: '2024-02-29' },
      { at: '0001-01-01' },
      { at: '2026-09-29T12:30:00Z' },
      { at: '2026-09-29T12:30:00.123+02:00' },
      { at: '2016-12-31T23:59:60Z' },
      { label: '2009/10' },
      { label: 'Sept 2026' },
      { label: 'x'.repeat(40) },
      { label: '🏆'.repeat(40) },
      { at: '2026-09-29', label: 'Sept 2026' },
    ]) {
      const view = listView({ renderer: 'timeline', data: { events: [{ title: 'Milestone', ...event }] } });
      assert.equal(await validate(view), true, JSON.stringify(event));
      assert.equal(isGeneratedView(view), true, JSON.stringify(event));
    }
    for (const event of [
      {}, { label: '' }, { label: 'x'.repeat(41) }, { label: 2009 }, { label: null },
      { label: '🏆'.repeat(41) },
      { at: null }, { at: '2009/10' }, { at: '29 September 2026' },
      { at: '2026-02-29' }, { at: '2026-04-31' }, { at: '2026-9-29' },
      { at: '2026-09-29T12:30:00' }, { at: '2026-09-29T24:00:00Z' },
      { at: '2026-09-29T12:30:00+24:00' },
      { at: '2026-09-29T12:30:00+02' }, { at: '2026-09-29T12:30:00+0200' },
      { at: '2026-09-29', label: '' }, { at: 'invalid', label: '2009/10' },
      { label: '2009/10', unknown: true },
    ]) {
      const view = listView({ renderer: 'timeline', data: { events: [{ title: 'Milestone', ...event }] } });
      assert.equal(await validate(view), false, JSON.stringify(event));
      assert.equal(isGeneratedView(view), false, JSON.stringify(event));
    }
  } finally {
    await app.close();
  }
});

test('Folio contracts use bounded searchable item metadata and closed item kinds', () => {
  const item = {
    id: 'research:56a2b0bd-af47-46b5-8e15-c6e9a718ae93',
    title: 'Ignite report',
    kind: 'research',
    createdAt: '2026-10-06T10:00:00.000Z',
    promptSummary: 'Research Ignite battery storage',
    pinned: false,
  };
  assert.deepEqual(folioKinds, ['research', 'html_app', 'image', 'knowledge_graph']);
  assert.equal(folioItemSchema.properties.promptSummary.maxLength, 500);
  assert.equal(folioSearchResponseSchema.properties.items.maxItems, 100);
  assert.equal(isFolioItem(item), true);
  assert.equal(isFolioItem({ ...item, kind: 'conversation' }), false);
  assert.equal(isFolioItem({ ...item, promptSummary: ' Research ' }), false);
});

test('clipboard contracts bound UTF-8 text and keep read/write result shapes exact', () => {
  assert.equal(clipboardTextMaxBytes, 20 * 1024);
  assert.equal(isClipboardText('x'.repeat(clipboardTextMaxBytes)), true);
  assert.equal(isClipboardText('é'.repeat(clipboardTextMaxBytes / 2)), true);
  assert.equal(isClipboardText('é'.repeat(clipboardTextMaxBytes / 2 + 1)), false);
  assert.equal(isClipboardText(null), false);
  assert.equal(isClipboardText('\0'), false);
  assert.equal(isClipboardReadResult({ text: 'clipboard text' }), true);
  assert.equal(isClipboardReadResult({ text: 'x'.repeat(clipboardTextMaxBytes + 1) }), false);
  assert.equal(isClipboardReadResult({ text: '', extra: true }), false);
  assert.equal(isClipboardWriteResult({ written: true }), true);
  assert.equal(isClipboardWriteResult({ written: false }), false);
});

test('system smoke contract requires the six ordered allowlisted checks and sanitized values', () => {
  const report = {
    checkedAt: '2026-10-08T02:00:00.000Z',
    entries: systemSmokeCheckIds.map((id) => ({
      id, status: 'ok', checkedAt: '2026-10-08T02:00:00.000Z',
    })),
  };
  assert.equal(isSystemSmokeStatus(report), true);
  assert.equal(isSystemSmokeStatus({ ...report, entries: report.entries.slice(1) }), false);
  assert.equal(isSystemSmokeStatus({
    ...report, entries: [{ ...report.entries[0], id: 'provider-token' }, ...report.entries.slice(1)],
  }), false);
  assert.equal(isSystemSmokeStatus({
    ...report, entries: [{ ...report.entries[0], detail: 'secret' }, ...report.entries.slice(1)],
  }), false);
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

test('voice tuning contracts bound persisted VAD, interruption, and reply length settings', () => {
  assert.deepEqual(voiceTuningSettingsBounds, {
    serverVadThreshold: { minimum: 0, maximum: 1 },
    prefixPaddingMs: { minimum: 0, maximum: 2_000 },
    silenceDurationMs: { minimum: 100, maximum: 5_000 },
    maxSpokenReplyTokens: { minimum: 1, maximum: 4_096 },
  });
  assert.deepEqual(voiceTuningSettingsSchema.properties, {
    serverVadThreshold: { type: 'number', minimum: 0, maximum: 1 },
    prefixPaddingMs: { type: 'integer', minimum: 0, maximum: 2_000 },
    silenceDurationMs: { type: 'integer', minimum: 100, maximum: 5_000 },
    bargeInEnabled: { type: 'boolean' },
    maxSpokenReplyTokens: { type: 'integer', minimum: 1, maximum: 4_096 },
  });
});

test('research settings contracts bound depth, source count, and invocation timeout', () => {
  assert.deepEqual(researchDepths, ['quick', 'standard', 'deep']);
  assert.deepEqual(researchSettingsBounds, {
    maxSources: { minimum: 1, maximum: 50 },
    timeoutSeconds: { minimum: 1, maximum: 320 },
  });
  assert.deepEqual(researchSettingsSchema.properties, {
    depth: { type: 'string', enum: ['quick', 'standard', 'deep'] },
    maxSources: { type: 'integer', minimum: 1, maximum: 50 },
    timeoutSeconds: { type: 'integer', minimum: 1, maximum: 320 },
  });
});

test('timeout settings contracts bound tool, long-tool and backend HTTP requests', () => {
  assert.deepEqual(timeoutSettingsBounds, {
    toolTimeoutSeconds: { minimum: 1, maximum: 120 },
    longToolTimeoutSeconds: { minimum: 30, maximum: 320 },
    backendHttpTimeoutSeconds: { minimum: 1, maximum: 60 },
  });
  assert.deepEqual(timeoutSettingsSchema.properties, {
    toolTimeoutSeconds: { type: 'integer', minimum: 1, maximum: 120 },
    longToolTimeoutSeconds: { type: 'integer', minimum: 30, maximum: 320 },
    backendHttpTimeoutSeconds: { type: 'integer', minimum: 1, maximum: 60 },
  });
});

test('routine rename contract bounds names and accepts only the name field', () => {
  assert.equal(routineNameMaxLength, 80);
  assert.deepEqual(routineNameSchema, {
    type: 'string', minLength: 1, maxLength: 80, pattern: '\\S',
  });
  assert.deepEqual(routineUpdateSchema, {
    type: 'object',
    properties: { name: routineNameSchema },
    required: ['name'],
    additionalProperties: false,
  });
});

test('memory settings contracts bound retrieval, graph threshold and automatic capture', () => {
  assert.deepEqual(memorySettingsBounds, {
    similarityThreshold: { minimum: 0, maximum: 1 },
    searchTopK: { minimum: 1, maximum: 8 },
    graphTextSimilarityThreshold: { minimum: 0, maximum: 1 },
  });
  assert.deepEqual(memorySettingsSchema.properties, {
    similarityThreshold: { type: 'number', minimum: 0, maximum: 1 },
    searchTopK: { type: 'integer', minimum: 1, maximum: 8 },
    graphTextSimilarityThreshold: { type: 'number', minimum: 0, maximum: 1 },
    automaticCapture: { type: 'boolean' },
  });
});

test('home location settings contract bounds city and nullable coordinates', () => {
  assert.deepEqual(homeLocationSettingsSchema, {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: {
      city: { type: 'string', maxLength: 100 },
      latitude: { anyOf: [{ type: 'number', minimum: -90, maximum: 90 }, { type: 'null' }] },
      longitude: { anyOf: [{ type: 'number', minimum: -180, maximum: 180 }, { type: 'null' }] },
    },
  });
});

test('renderer and action identifiers match the JSON schema allowlists', () => {
  assert.deepEqual(generatedViewSchema.oneOf.map((schema) => schema.properties.renderer.const), generatedViewRenderers);
  assert.deepEqual(generatedViewActionTypes, ['open-route', 'open-link', 'call-tool', 'window']);
  assert.equal(new Set(generatedViewRenderers).size, generatedViewRenderers.length);
});

test('work activity detail and lifecycle accept bounded updates with the same activity ID', () => {
  const detail = {
    activityId: '12345678-1234-4234-8234-123456789abc',
    kind: 'repo_read',
    text: "I'm reading the settings module",
    target: { label: 'jarvis/settings.ts' },
  };
  assert.equal(jarvisWorkActivityDetailSchema.properties.text.maxLength, 80);
  assert.deepEqual(jarvisWorkActivityDetailSchema.properties.kind.enum, jarvisWorkActivityKinds);
  for (const kind of jarvisWorkActivityKinds) {
    assert.equal(isJarvisWorkActivityDetail({ ...detail, kind }), true, kind);
    assert.equal(isJarvisActivityEvent({ ...detail, kind, type: 'work-started' }), true, kind);
  }
  assert.equal(isJarvisWorkActivityDetail({ ...detail, text: `I ${'x'.repeat(78)}` }), true);
  for (const text of ['Searching your vault for Ignite', 'Reading settings', "I'm reading settings"]) {
    assert.equal(isJarvisWorkActivityDetail({ ...detail, text }), true);
    assert.equal(isJarvisActivityEvent({ ...detail, text, type: 'work-started' }), true);
    assert.equal(new RegExp(jarvisWorkActivityDetailSchema.properties.text.pattern).test(text), true);
  }
  for (const source of [undefined, 'chat', 'voice']) {
    const started = { ...detail, type: 'work-started', ...(source ? { source } : {}) };
    const finished = { type: 'work-finished', activityId: detail.activityId, ...(source ? { source } : {}) };
    assert.equal(isJarvisActivityEvent(started), true);
    assert.equal(isJarvisActivityEvent(finished), true);
    assert.equal(isNowSseEvent({ event: 'jarvis-activity', data: started }), true);
    assert.equal(isNowSseEvent({ event: 'jarvis-activity', data: finished }), true);
  }
  for (const invalid of [
    { activityId: 'not-a-uuid' }, { activityId: null }, { kind: 'reading' },
    { text: '' }, { text: `I ${'x'.repeat(79)}` },
    { text: 'I am\nreading' }, { text: 'I am\u0000reading' },
    { target: null }, { target: { label: '' } }, { target: { label: ' ' } },
    { target: { label: 'x'.repeat(201) } }, { target: { label: 'Repo', url: 'https://github.com' } },
    { secret: 'must not travel' },
  ]) {
    assert.equal(isJarvisWorkActivityDetail({ ...detail, ...invalid }), false, JSON.stringify(invalid));
    assert.equal(isJarvisActivityEvent({ ...detail, ...invalid, type: 'work-started' }), false);
  }
  assert.equal(isJarvisActivityEvent({ ...detail, type: 'work-started', source: 'agent' }), false);
  for (const invalid of [
    { activityId: 'invalid' }, { source: 'agent' }, { text: 'I finished' }, { outcome: 'ok' },
  ]) {
    assert.equal(isJarvisActivityEvent({ type: 'work-finished', activityId: detail.activityId, ...invalid }), false);
  }
});

test('code views preserve plain-text content and bound code, line numbers and absolute highlights', () => {
  const data = {
    repo: 'DanAakesen/jarvis', path: 'apps/backend/src/core/settings.ts', ref: 'main',
    language: 'typescript', content: 'const html = "<script>not executable</script>";\nexport { html };',
    startLine: 121, highlight: [{ from: 121, to: 122 }], query: 'html',
  };
  assert.equal(generatedCodeDataSchema.properties.content.maxLength, 200_000);
  assert.equal(generatedCodeDataSchema.properties.startLine.type, 'integer');
  assert.equal(generatedCodeDataSchema.properties.highlight.items.additionalProperties, false);
  assert.equal(isGeneratedCodeData(data), true);
  assert.equal(isGeneratedView(listView({ renderer: 'code', data })), true);
  assert.equal(isGeneratedView(listView({
    renderer: 'code', source: { id: 'factory.projects', status: 'complete' },
    data: {
      repo: 'DanAakesen/jarvis', path: 'Search results', startLine: 1,
      content: 'src/settings.ts:121 showWork: true\nsrc/activity.ts:42 work-started',
      highlight: [{ from: 1, to: 1 }, { from: 2, to: 2 }],
    },
  })), true);
  assert.equal(isWorkspaceCommand({
    commandId: 'code-read', operation: 'create', viewId: 'code-read',
    view: listView({ renderer: 'code', data }),
  }), true);
  assert.equal(isGeneratedCodeData({ repo: 'r', path: 'p', content: '' }), true);
  assert.equal(isGeneratedCodeData({ repo: 'r', path: 'p', content: 'x'.repeat(200_000) }), true);
  for (const separator of ['\n', '\r', '\r\n']) {
    const content = Array(400).fill('line').join(separator);
    assert.equal(isGeneratedCodeData({ ...data, content, highlight: [{ from: 121, to: 520 }] }), true);
    assert.equal(isGeneratedCodeData({ ...data, content: `${content}${separator}line` }), false);
    assert.equal(isGeneratedCodeData({ ...data, content: `${content}${separator}` }), false);
    assert.equal(new RegExp(generatedCodeDataSchema.properties.content.pattern).test(content), true);
    assert.equal(new RegExp(generatedCodeDataSchema.properties.content.pattern).test(`${content}${separator}line`), false);
    assert.equal(new RegExp(generatedCodeDataSchema.properties.content.pattern).test(`${content}${separator}`), false);
  }
  for (const invalid of [
    { repo: '' }, { path: ' ' }, { content: null }, { content: 'x'.repeat(200_001) },
    { startLine: 0 }, { startLine: -1 }, { startLine: 1.5 }, { startLine: '121' },
    { startLine: null }, { startLine: Number.MAX_SAFE_INTEGER }, { startLine: Infinity },
    { ref: '' }, { language: null }, { query: ' ' }, { html: '<script>' },
    { highlight: null }, { highlight: Array(401).fill({ from: 121, to: 122 }) },
    { highlight: [{ from: 121 }] }, { highlight: [{ from: 122, to: 121 }] },
    { highlight: [{ from: 120, to: 121 }] }, { highlight: [{ from: 121, to: 123 }] },
    { highlight: [{ from: 121.5, to: 122 }] }, { highlight: [{ from: 121, to: '122' }] },
    { highlight: [{ from: 121, to: 122, text: 'unexpected' }] },
  ]) {
    assert.equal(isGeneratedCodeData({ ...data, ...invalid }), false, JSON.stringify(invalid));
    assert.equal(isGeneratedView(listView({ renderer: 'code', data: { ...data, ...invalid } })), false);
  }
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

test('Now SSE contracts guard every named event and its payload', () => {
  const activityId = '12345678-1234-4234-8234-123456789abc';
  const timestamp = '2026-10-07T12:00:00.000Z';
  const job = {
    jobId: '12345678-1234-4234-8234-123456789abc',
    kind: 'research',
    title: 'Research result',
    status: 'running',
    step: 1,
    steps: 2,
    startedAt: timestamp,
    updatedAt: timestamp,
  };
  const events = [
    { event: 'mode', data: {} },
    { event: 'now', data: {} },
    { event: 'voice-wake', data: { type: 'voice.wake', at: timestamp } },
    { event: 'job', data: job },
    { event: 'jarvis-activity', data: { type: 'listening', activityId, source: 'voice' } },
    { event: 'workspace-ready', data: { sessionId: activityId, trustedBlobHost: 'jarvis.blob.core.windows.net' } },
    {
      event: 'workspace-command',
      data: { command: { commandId: 'cmd_1', operation: 'show', viewId: 'report' }, expiresAt: 1_791_379_200_000 },
    },
    { event: 'workspace-cancel', data: { commandId: 'cmd_1' } },
    { event: 'board', data: { projectId: '42', version: 1 } },
  ];

  assert.deepEqual(nowSseEventNames, events.map(({ event }) => event));
  for (const event of events) assert.equal(isNowSseEvent(event), true, event.event);
  assert.equal(isNowSseEvent({ event: 'mode', data: { mode: 'away' } }), false);
  assert.equal(isNowSseEvent({ event: 'board', data: { projectId: '0', version: 1 } }), false);
  assert.equal(isNowSseEvent({ event: 'job', data: { ...job, unexpected: true } }), false);
  assert.equal(isNowSseEvent({
    event: 'workspace-command',
    data: { command: { commandId: 'cmd_1', operation: 'show', viewId: 'report' }, expiresAt: -1 },
  }), false);
  assert.equal(isNowSseEvent({ event: 'workspace-cancel', data: { commandId: 'cmd_1', extra: true } }), false);
  assert.equal(isNowSseEvent({ event: 'unknown', data: {} }), false);
});

test('Factory board contract validates the exact ordered board, cards, and task overlay', () => {
  const timestamp = '2026-10-08T00:00:00.000Z';
  const board = {
    project: { id: '42', repo: 'DanAakesen/jarvis' },
    fetchedAt: timestamp,
    stale: false,
    columns: factoryBoardColumnIds.map((id) => ({ id, cards: [] })),
  };
  board.columns[4].cards.push({
    issue: {
      number: 7,
      url: 'https://github.com/DanAakesen/jarvis/issues/7',
      title: 'P10-04: Match board',
      taskCode: 'P10-04',
      labels: ['Codex'],
      worker: 'Codex',
      state: 'open',
      updatedAt: timestamp,
      closedAt: null,
      blockedBy: [],
    },
    pr: {
      number: 70,
      url: 'https://github.com/DanAakesen/jarvis/pull/70',
      draft: false,
      checks: 'passing',
    },
    task: {
      id: '81',
      state: 'Running',
      activity: 'Running tests',
      agent: 'codex',
      attemptCount: 1,
      branch: 'jarvis/task-81',
      startedAt: timestamp,
      latestSessionEndReason: null,
    },
  });

  assert.equal(isFactoryBoard(board), true);
  assert.equal(isFactoryBoardUpdate({ projectId: '42', version: 1 }), true);
  assert.equal(isFactoryBoardUpdate({ projectId: '42', version: 0 }), false);
  assert.equal(isFactoryBoard({ ...board, columns: [...board.columns].reverse() }), false);
  assert.equal(isFactoryBoard({
    ...board,
    columns: board.columns.map((column, index) =>
      index === 4 ? { ...column, cards: [{ ...column.cards[0], issue: { ...column.cards[0].issue, url: 'http://github.com/issues/7' } }] } : column),
  }), false);
  assert.equal(isFactoryBoard({
    ...board,
    columns: board.columns.map((column, index) =>
      index === 4 ? { ...column, cards: [{ ...column.cards[0], task: { ...column.cards[0].task, unexpected: true } }] } : column),
  }), false);
});

test('task-event and task stream contracts constrain persisted event identity and shape', () => {
  const event = {
    id: '42',
    taskId: '7',
    type: 'state_changed',
    summary: null,
    payload: { to: 'Running' },
    payloadTruncated: false,
    source: 'backend',
    at: '2026-10-07T12:00:00.000Z',
  };

  assert.equal(isTaskEventRecord(Object.fromEntries(
    Object.entries(event).filter(([key]) => key !== 'taskId'),
  )), true);
  assert.equal(isTaskEventMessage(event), true);
  assert.equal(isTaskEventStreamEvent({ event: 'task', id: event.id, data: event }), true);
  assert.equal(isTaskEventStreamEvent({ event: 'ready', data: {} }), true);
  assert.equal(isTaskEventRecord({ ...event, id: '9223372036854775808' }), false);
  assert.equal(isTaskEventMessage({ ...event, taskId: '0' }), false);
  assert.equal(isTaskEventMessage({ ...event, at: 'October 7, 2026' }), false);
  assert.equal(isTaskEventStreamEvent({ event: 'task', id: '43', data: event }), false);
  assert.equal(isTaskEventStreamEvent({ event: 'ready', data: { replayed: true } }), false);
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

test('accepts bounded declarative views from running, complete, partial and unavailable sources', () => {
  assert.equal(isGeneratedView(listView()), true);
  assert.equal(isGeneratedView(listView({ source: { id: 'research', status: 'running' } })), true);
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
    { renderer: 'code', data: { repo: 'DanAakesen/jarvis', path: 'index.js', content: '<script>plain text</script>' } },
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
    { ...base, operation: 'place', viewId: 'research', region: 'centre' },
    { ...base, operation: 'arrange', layout: 'side-by-side', viewIds: ['research', 'chart'] },
    { ...base, operation: 'arrange', layout: 'auto' },
    ...['minimise-all', 'restore-all', 'close-all'].map((operation) => ({ ...base, operation })),
    { ...base, operation: 'pin', viewId: 'research' },
    { ...base, operation: 'unpin', viewId: 'research' },
    { ...base, operation: 'context-panel', action: 'open', view: listView() },
    { ...base, operation: 'context-panel', action: 'open' },
    ...['close', 'toggle'].map((action) => ({ ...base, operation: 'context-panel', action })),
    ...['show', 'hide'].map((action) => ({ ...base, operation: 'conversation', action })),
  ];

  assert.equal(workspaceCommandSchema.type, 'object');
  for (const key of ['oneOf', 'anyOf', 'allOf', 'not']) {
    assert.equal(Object.hasOwn(workspaceCommandSchema, key), false, key);
  }
  for (const command of commands) assert.equal(isWorkspaceCommand(command), true, command.operation);
});

test('validates intent-based workspace commands and their exact fields', () => {
  const base = { commandId: 'intent-1' };
  const invalid = [
    { operation: 'place', viewId: 'report' },
    { operation: 'place', region: 'left' },
    { operation: 'place', viewId: 'report', region: 'center' },
    { operation: 'place', viewId: '../report', region: 'left' },
    { operation: 'place', viewId: 'report', region: 'left', extra: true },
    { operation: 'arrange' },
    { operation: 'arrange', layout: 'stacked' },
    { operation: 'arrange', layout: 'grid', viewIds: [] },
    { operation: 'arrange', layout: 'grid', viewIds: ['report', 'report'] },
    { operation: 'arrange', layout: 'grid', viewIds: Array.from({ length: 9 }, (_, index) => `view${index}`) },
    { operation: 'arrange', layout: 'grid', viewIds: ['../report'] },
    { operation: 'arrange', layout: 'grid', viewIds: ['report'], extra: true },
    ...['minimise-all', 'restore-all', 'close-all'].map((operation) => ({ operation, viewId: 'report' })),
    { operation: 'pin' },
    { operation: 'pin', viewId: 'report', extra: true },
    { operation: 'unpin' },
    { operation: 'unpin', viewId: 'report', extra: true },
  ];
  for (const command of invalid) {
    assert.equal(isWorkspaceCommand({ ...base, ...command }), false, JSON.stringify(command));
  }
  for (const operation of [
    'place', 'arrange', 'minimise-all', 'restore-all', 'close-all', 'pin', 'unpin',
  ]) {
    assert.equal(workspaceCommandSchema.properties.operation.enum.includes(operation), true, operation);
  }
  assert.deepEqual(workspaceCommandSchema.properties.region.enum, ['left', 'right', 'top', 'bottom', 'centre', 'full']);
  assert.deepEqual(workspaceCommandSchema.properties.layout.enum, ['auto', 'side-by-side', 'grid', 'cascade']);
  assert.deepEqual(
    workspaceCommandSchema.properties.viewIds,
    { type: 'array', minItems: 1, maxItems: 8, items: workspaceCommandSchema.properties.viewId, uniqueItems: true },
  );
});

test('validates conversation visibility actions without accepting unrelated fields', () => {
  const command = { commandId: 'conversation-1', operation: 'conversation' };
  for (const action of ['show', 'hide']) {
    assert.equal(isWorkspaceCommand({ ...command, action }), true, action);
  }
  for (const action of ['open', 'close', 'toggle', 'shown', '', null]) {
    assert.equal(isWorkspaceCommand({ ...command, action }), false, String(action));
  }
  assert.equal(isWorkspaceCommand({ ...command, action: 'show', viewId: 'conversation' }), false);
});

test('validates exact navigation keys, settings sections and bounded factory task/issue selectors', () => {
  const command = { commandId: 'navigate-1', operation: 'navigate' };
  assert.deepEqual(workspaceNavigationPages, [
    'home', 'factory', 'settings', 'usage', 'knowledge', 'folio', 'status',
  ]);
  assert.deepEqual(workspaceSettingsSections, [
    'appearance', 'jarvis', 'personality', 'voice', 'presence', 'memory',
    'coding', 'projects', 'routines', 'credentials', 'backend',
  ]);
  assert.deepEqual(workspaceCommandSchema.properties.page.enum, workspaceNavigationPages);
  assert.deepEqual(workspaceCommandSchema.properties.section.enum, workspaceSettingsSections);
  for (const page of workspaceNavigationPages) {
    const navigation = { ...command, page };
    assert.equal(isWorkspaceCommand(navigation), true, page);
    assert.equal(isNowSseEvent({
      event: 'workspace-command', data: { command: navigation, expiresAt: 1_791_379_200_000 },
    }), true, page);
  }
  for (const section of workspaceSettingsSections) {
    assert.equal(isWorkspaceCommand({ ...command, page: 'settings', section }), true, section);
  }
  for (const taskId of ['1', '9223372036854775807']) {
    assert.equal(isWorkspaceCommand({ ...command, page: 'factory', taskId }), true, taskId);
  }
  for (const issueNumber of [1, 567, Number.MAX_SAFE_INTEGER]) {
    const navigation = { ...command, page: 'factory', issueNumber };
    assert.equal(isWorkspaceCommand(navigation), true, String(issueNumber));
    assert.equal(isWorkspaceCommand({ ...navigation, taskId: '42' }), true);
    assert.equal(isNowSseEvent({
      event: 'workspace-command', data: { command: navigation, expiresAt: 1_791_379_200_000 },
    }), true);
  }
  for (const invalid of [
    {}, { page: 'kanban' }, { page: 'knowledge-graph' }, { page: '/settings' }, { page: 'https://example.com' },
    { page: 'settings', section: 'unknown' }, { page: 'settings', section: null },
    { page: 'home', section: 'voice' }, { page: 'settings', taskId: '1' },
    { page: 'factory', section: 'voice' }, { page: 'home', viewId: 'conversation' },
    { page: 'home', issueNumber: 567 }, { page: 'settings', issueNumber: 567 },
    ...['global', 'new-projects', 'task-recipes'].map((section) => ({ page: 'settings', section })),
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY, '567', null]
      .map((issueNumber) => ({ page: 'factory', issueNumber })),
    ...['0', '01', '-1', '1/../../settings', '9223372036854775808', '9'.repeat(20), 1, null]
      .map((taskId) => ({ page: 'factory', taskId })),
  ]) {
    assert.equal(isWorkspaceCommand({ ...command, ...invalid }), false, JSON.stringify(invalid));
  }
});

test('defines the presence request and response contracts', () => {
  assert.deepEqual(presenceModes, ['present', 'away', 'on_the_move']);
  assert.deepEqual(presenceSources, ['manual', 'device', 'jarvis', 'browser']);
  assert.deepEqual(presenceUpdateSchema.properties.source.enum, ['manual', 'device']);
  assert.deepEqual(presenceStateSchema.properties.ignored, { const: 'recent_manual' });

  const state = { mode: 'on_the_move', source: 'device', changedAt: '2026-10-08T08:00:00.000Z' };
  assert.equal(isPresenceState(state), true);
  assert.equal(isPresenceState({ ...state, ignored: 'recent_manual' }), true);
  assert.equal(isPresenceState({ ...state, ignored: 'other' }), false);
  assert.equal(isPresenceState({ ...state, source: 'teams_presence' }), false);
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

test('validates bounded background job details and history steps', () => {
  const job = {
    jobId: '00000000-0000-4000-8000-000000000014',
    kind: 'research',
    title: 'Research: SQL persistence',
    status: 'failed',
    step: 1,
    steps: 3,
    detail: 'Research could not be completed.',
    startedAt: '2026-10-07T12:00:00.000Z',
    updatedAt: '2026-10-07T12:01:00.000Z',
  };
  const step = {
    status: 'running',
    step: 1,
    detail: 'Searching: sources',
    updatedAt: '2026-10-07T12:00:30.000Z',
  };
  assert.equal(isBackgroundJobStep(step), true);
  assert.equal(isBackgroundJobDetails({ job, steps: [step], error: job.detail, retryable: true }), true);
  assert.equal(isBackgroundJobDetails({ job, steps: Array(101).fill(step), retryable: true }), false);
  assert.equal(isBackgroundJobDetails({ job, steps: [step], retryable: true, extra: true }), false);
  assert.equal(isBackgroundJobDetails({ job: { ...job, status: 'done' }, steps: [step], retryable: true }), false);
});
