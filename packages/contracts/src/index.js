export { dailyViewIds, dailyModuleId, dailyContractVersion } from './daily.js';
export { dailyQuerySources, dailyQuerySourcesV1, dailyQuerySourcesV2, dailyQuerySourcesV3, dailyQuerySourcesV4, dailyQuerySourcesV5, dailyQuerySourcesV5WithoutFeeds, dailyQuerySourcesV6, dailyQuerySourcesV6WithoutFeeds, dailyQuerySourcesV6WithoutTrainingTargets, dailyQuerySourcesV6WithoutFeedsOrTrainingTargets, dailyCapabilitiesVersion, dailyCapabilitiesAccept, dailyQuerySchema, isDailyQuery } from './daily.js';
export { vaultMirrorStatusSchema, vaultMirrorStatusViewSchema } from './vault-mirror.js';

export const generatedViewVersion = 1;
export const systemSmokeCheckIds = Object.freeze([
  'google', 'github_app', 'vault', 'foundry.embeddings', 'research', 'pc_bridge', 'agent_contract',
  'chat_canary', 'chat_identity', 'chat_capabilities', 'chat_github_read', 'chat_jobs',
  'chat_navigation', 'chat_no_timestamp', 'chat_plain_approval',
]);
export const modelRoles = Object.freeze([
  'chat', 'vision', 'research', 'voice', 'transcription', 'embedding', 'codex', 'copilot',
]);
export const reasoningEfforts = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
export const modelCapabilities = Object.freeze([
  'chat', 'responses', 'realtime', 'transcription', 'embeddings', 'image',
]);
export const clipboardTextMaxBytes = 20 * 1024;

export function isClipboardText(value) {
  return typeof value === 'string' && !value.includes('\0') &&
    new TextEncoder().encode(value).byteLength <= clipboardTextMaxBytes;
}

export function isClipboardReadResult(value) {
  return isObject(value) && Object.keys(value).length === 1 && isClipboardText(value.text);
}

export function isClipboardWriteResult(value) {
  return isObject(value) && Object.keys(value).length === 1 && value.written === true;
}

export const voiceTuningSettingsBounds = Object.freeze({
  serverVadThreshold: Object.freeze({ minimum: 0, maximum: 1 }),
  prefixPaddingMs: Object.freeze({ minimum: 0, maximum: 2_000 }),
  silenceDurationMs: Object.freeze({ minimum: 100, maximum: 5_000 }),
  maxSpokenReplyTokens: Object.freeze({ minimum: 1, maximum: 4_096 }),
});
export const voiceTuningSettingsSchema = Object.freeze({
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: Object.freeze({
    serverVadThreshold: Object.freeze({ type: 'number', ...voiceTuningSettingsBounds.serverVadThreshold }),
    prefixPaddingMs: Object.freeze({ type: 'integer', ...voiceTuningSettingsBounds.prefixPaddingMs }),
    silenceDurationMs: Object.freeze({ type: 'integer', ...voiceTuningSettingsBounds.silenceDurationMs }),
    bargeInEnabled: Object.freeze({ type: 'boolean' }),
    maxSpokenReplyTokens: Object.freeze({ type: 'integer', ...voiceTuningSettingsBounds.maxSpokenReplyTokens }),
  }),
});
export const researchDepths = Object.freeze(['quick', 'standard', 'deep']);
export const researchSettingsBounds = Object.freeze({
  maxSources: Object.freeze({ minimum: 1, maximum: 50 }),
  timeoutSeconds: Object.freeze({ minimum: 1, maximum: 320 }),
});
export const researchSettingsSchema = Object.freeze({
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: Object.freeze({
    depth: Object.freeze({ type: 'string', enum: [...researchDepths] }),
    maxSources: Object.freeze({ type: 'integer', ...researchSettingsBounds.maxSources }),
    timeoutSeconds: Object.freeze({ type: 'integer', ...researchSettingsBounds.timeoutSeconds }),
  }),
});
export const timeoutSettingsBounds = Object.freeze({
  toolTimeoutSeconds: Object.freeze({ minimum: 1, maximum: 120 }),
  longToolTimeoutSeconds: Object.freeze({ minimum: 30, maximum: 320 }),
  backendHttpTimeoutSeconds: Object.freeze({ minimum: 1, maximum: 60 }),
});
export const timeoutSettingsSchema = Object.freeze({
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: Object.freeze({
    toolTimeoutSeconds: Object.freeze({
      type: 'integer', ...timeoutSettingsBounds.toolTimeoutSeconds,
    }),
    longToolTimeoutSeconds: Object.freeze({
      type: 'integer', ...timeoutSettingsBounds.longToolTimeoutSeconds,
    }),
    backendHttpTimeoutSeconds: Object.freeze({
      type: 'integer', ...timeoutSettingsBounds.backendHttpTimeoutSeconds,
    }),
  }),
});
export const routineNameMaxLength = 80;
export const routineNameSchema = Object.freeze({
  type: 'string',
  minLength: 1,
  maxLength: routineNameMaxLength,
  pattern: '\\S',
});
export const routineUpdateSchema = Object.freeze({
  type: 'object',
  properties: Object.freeze({ name: routineNameSchema }),
  required: Object.freeze(['name']),
  additionalProperties: false,
});
export const memorySettingsBounds = Object.freeze({
  similarityThreshold: Object.freeze({ minimum: 0, maximum: 1 }),
  searchTopK: Object.freeze({ minimum: 1, maximum: 8 }),
  graphTextSimilarityThreshold: Object.freeze({ minimum: 0, maximum: 1 }),
});
export const memorySettingsSchema = Object.freeze({
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: Object.freeze({
    similarityThreshold: Object.freeze({ type: 'number', ...memorySettingsBounds.similarityThreshold }),
    searchTopK: Object.freeze({ type: 'integer', ...memorySettingsBounds.searchTopK }),
    graphTextSimilarityThreshold: Object.freeze({
      type: 'number', ...memorySettingsBounds.graphTextSimilarityThreshold,
    }),
    automaticCapture: Object.freeze({ type: 'boolean' }),
  }),
});
export const homeLocationSettingsSchema = Object.freeze({
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: Object.freeze({
    city: Object.freeze({ type: 'string', maxLength: 100 }),
    latitude: Object.freeze({
      anyOf: Object.freeze([
        Object.freeze({ type: 'number', minimum: -90, maximum: 90 }),
        Object.freeze({ type: 'null' }),
      ]),
    }),
    longitude: Object.freeze({
      anyOf: Object.freeze([
        Object.freeze({ type: 'number', minimum: -180, maximum: 180 }),
        Object.freeze({ type: 'null' }),
      ]),
    }),
  }),
});
export function isModelCatalogue(value) {
  if (!isObject(value) || !['arm', 'fallback'].includes(value.source) ||
      !Array.isArray(value.deployments) || value.deployments.length > 1_000 ||
      Object.keys(value).some((key) => !['source', 'deployments', 'reason'].includes(key)) ||
      (value.reason !== undefined && !boundedText(value.reason, 500))) return false;
  const names = new Set();
  return value.deployments.every((deployment) => {
    if (!isObject(deployment) ||
        Object.keys(deployment).some((key) =>
          !['name', 'model', 'version', 'sku', 'capacity', 'capabilities', 'reasoningEfforts'].includes(key)) ||
        !boundedText(deployment.name, 128) || names.has(deployment.name) ||
        !boundedText(deployment.model, 128) || !boundedText(deployment.version, 128) ||
        !boundedText(deployment.sku, 64) ||
        !Number.isSafeInteger(deployment.capacity) || deployment.capacity < 0 ||
        !Array.isArray(deployment.capabilities) ||
        !deployment.capabilities.every((capability) => modelCapabilities.includes(capability)) ||
        new Set(deployment.capabilities).size !== deployment.capabilities.length ||
        !Array.isArray(deployment.reasoningEfforts) ||
        deployment.reasoningEfforts.length === 0 ||
        !deployment.reasoningEfforts.every((effort) => reasoningEfforts.includes(effort)) ||
        new Set(deployment.reasoningEfforts).size !== deployment.reasoningEfforts.length) return false;
    names.add(deployment.name);
    return true;
  });
}

export const generatedViewRenderers = Object.freeze([
  'table', 'list', 'detail', 'text', 'timeline', 'chart', 'task-card', 'status', 'image', 'html-app',
  'knowledge-graph', 'code',
]);
export const generatedViewActionTypes = Object.freeze(['open-route', 'open-link', 'call-tool', 'window']);

const maxBytes = 256 * 1024;
export const htmlArtifactByteLimit = 512 * 1024;
const rowLimit = 500;
const maxSqlBigInt = 9_223_372_036_854_775_807n;
const dateTime = { type: 'string', format: 'date-time' };
const string = (maxLength, minLength = 0) => ({ type: 'string', maxLength, ...(minLength ? { minLength } : {}) });
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const array = (items, maxItems, minItems = 0) => ({
  type: 'array', items, maxItems, ...(minItems ? { minItems } : {}),
});
export const presenceModes = Object.freeze(['present', 'away', 'on_the_move']);
export const presenceSources = Object.freeze(['manual', 'device', 'jarvis', 'browser']);
export const presenceUpdateSchema = Object.freeze(object({
  mode: { type: 'string', enum: [...presenceModes] },
  source: { type: 'string', enum: ['manual', 'device'] },
}, ['mode']));
export const presenceStateSchema = Object.freeze(object({
  mode: { type: 'string', enum: [...presenceModes] },
  source: { type: 'string', enum: [...presenceSources] },
  changedAt: { anyOf: [dateTime, { type: 'null' }] },
  ignored: { const: 'recent_manual' },
}, ['mode', 'source', 'changedAt']));
export function isPresenceState(value) {
  return isObject(value) &&
    Object.keys(value).every((key) => ['mode', 'source', 'changedAt', 'ignored'].includes(key)) &&
    presenceModes.includes(value.mode) &&
    presenceSources.includes(value.source) &&
    (value.changedAt === null || typeof value.changedAt === 'string' && Number.isFinite(Date.parse(value.changedAt))) &&
    (value.ignored === undefined || value.ignored === 'recent_manual');
}
const codeLineSchema = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
export const generatedCodeDataSchema = Object.freeze(object({
  repo: { ...string(200, 1), pattern: '\\S' },
  path: { ...string(2_048, 1), pattern: '\\S' },
  ref: { ...string(200, 1), pattern: '\\S' },
  language: { ...string(64, 1), pattern: '\\S' },
  content: { ...string(200_000), pattern: '^(?:[^\\r\\n]*(?:\\r\\n|\\r(?!\\n)|\\n)){0,399}[^\\r\\n]*$(?![\\s\\S])' },
  startLine: codeLineSchema,
  highlight: array(object({ from: codeLineSchema, to: codeLineSchema }), 400),
  query: { ...string(500, 1), pattern: '\\S' },
}, ['repo', 'path', 'content']));
const routeActionSchema = object({
  type: { const: 'open-route' },
  route: {
    ...string(200, 1),
    pattern: '^/(?:$|factory/tasks/[1-9][0-9]{0,18}|factory/(?:projects|releases)/[1-9][0-9]{0,15}|usage|settings)(?:\\?[^#]*)?$',
  },
});
const externalLinkActionSchema = object({
  type: { const: 'open-link' },
  url: {
    type: 'string',
    format: 'uri',
    maxLength: 2_000,
    pattern: '^https://(?:github\\.com|(?:[a-z0-9-]+\\.)*azure\\.com|learn\\.microsoft\\.com)(?:[/?#].*)?$',
  },
  label: string(200, 1),
});
const windowActionSchema = {
  oneOf: [
    ...['focus', 'minimise', 'restore', 'close'].map((operation) => object({
      type: { const: 'window' },
      operation: { const: operation },
      windowId: string(64, 1),
    })),
    object({
      type: { const: 'window' },
      operation: { const: 'move' },
      windowId: string(64, 1),
      x: { type: 'number', minimum: 0, maximum: 10_000 },
      y: { type: 'number', minimum: 0, maximum: 10_000 },
    }),
    object({
      type: { const: 'window' },
      operation: { const: 'resize' },
      windowId: string(64, 1),
      width: { type: 'number', exclusiveMinimum: 0, maximum: 10_000 },
      height: { type: 'number', exclusiveMinimum: 0, maximum: 10_000 },
      x: { type: 'number', minimum: 0, maximum: 10_000 },
      y: { type: 'number', minimum: 0, maximum: 10_000 },
    }, ['type', 'operation', 'windowId', 'width', 'height']),
  ],
};
const actionSchema = {
  oneOf: [
    routeActionSchema,
    externalLinkActionSchema,
    object({ type: { const: 'call-tool' }, tool: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' } }),
    windowActionSchema,
  ],
};
const listItem = object({
  title: string(200, 1),
  description: string(2_000),
  details: array(object({ label: string(100, 1), value: string(2_000) }), 10),
  action: { oneOf: [routeActionSchema, externalLinkActionSchema] },
}, ['title']);
const sourceSchema = object({
  id: { type: 'string', enum: ['now', 'factory.tasks', 'factory.projects', 'usage', 'image_generation', 'html_generation', 'research', 'knowledge_graph'] },
  status: { type: 'string', enum: ['complete', 'partial', 'unavailable'] },
  updatedAt: dateTime,
  reason: string(500),
  page: object({
    limit: { type: 'integer', minimum: 1, maximum: 1_000 },
    offset: { type: 'integer', minimum: 0, maximum: 10_000 },
    total: { type: 'integer', minimum: 0, maximum: 1_000_000 },
    nextOffset: { anyOf: [{ type: 'integer', minimum: 0, maximum: 10_000 }, { type: 'null' }] },
  }, ['limit', 'offset', 'nextOffset']),
}, ['id', 'status']);
const webResearchSourceSchema = object({
  title: string(200, 1),
  url: { type: 'string', format: 'uri', maxLength: 2_048, pattern: '^https://' },
  retrievedAt: dateTime,
});
const htmlArtifactSourceSchema = object({
  title: string(200, 1),
  url: { type: 'string', format: 'uri', maxLength: 2_048, pattern: '^https://' },
});
export const htmlArtifactSchema = Object.freeze(object({
  id: { type: 'string', format: 'uuid' },
  kind: { const: 'html' },
  title: string(200, 1),
  html: string(htmlArtifactByteLimit, 1),
  sources: array(htmlArtifactSourceSchema, 50),
  createdAt: dateTime,
  pinned: { type: 'boolean' },
}));
export const workspaceItemKinds = Object.freeze(['research', 'html_app', 'image', 'knowledge_graph']);
const workspaceItemIdPattern = '^(?:research|html_app|image|knowledge_graph):[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$';
const workspaceItemIdRegex = new RegExp(workspaceItemIdPattern, 'u');
export const workspaceItemSchema = Object.freeze(object({
  id: { type: 'string', pattern: workspaceItemIdPattern },
  title: string(200, 1),
  kind: { enum: workspaceItemKinds },
  createdAt: dateTime,
  promptSummary: string(500, 1),
  pinned: { type: 'boolean' },
}));
export const workspaceItemsSearchSchema = Object.freeze(object({
  q: string(120, 1),
  kind: { enum: workspaceItemKinds },
  before: dateTime,
}, []));
export const workspaceItemsSearchResponseSchema = Object.freeze(object({
  items: array(workspaceItemSchema, 100),
}));
export const workspaceItemPatchSchema = Object.freeze({
  type: 'object',
  properties: {
    title: { ...string(200, 1), pattern: '\\S' },
    pinned: { type: 'boolean' },
  },
  required: [],
  minProperties: 1,
  additionalProperties: false,
});
export const workspaceItemDeleteSchema = Object.freeze(object({
  confirm: { const: true },
}));
export const workspaceItemsSearchToolSchema = Object.freeze(object({
  q: { ...string(120, 1), pattern: '\\S' },
  kind: { enum: workspaceItemKinds },
}, []));
export const workspaceItemOpenToolSchema = Object.freeze({
  type: 'object',
  properties: {
    id: { type: 'string', pattern: workspaceItemIdPattern },
    query: { ...string(120, 1), pattern: '\\S' },
  },
  required: [],
  minProperties: 1,
  maxProperties: 1,
  additionalProperties: false,
});
export const workspacesManageToolSchema = Object.freeze(object({
  ...workspaceItemOpenToolSchema.properties,
  action: { type: 'string', enum: ['rename', 'pin', 'unpin', 'delete'] },
  title: workspaceItemPatchSchema.properties.title,
}, ['action']));
export const folioKinds = workspaceItemKinds;
export const folioItemSchema = workspaceItemSchema;
export const folioSearchSchema = workspaceItemsSearchSchema;
export const folioSearchResponseSchema = workspaceItemsSearchResponseSchema;
export const folioPatchSchema = workspaceItemPatchSchema;
export const folioDeleteSchema = workspaceItemDeleteSchema;
export const folioSearchToolSchema = workspaceItemsSearchToolSchema;
export const folioOpenToolSchema = workspaceItemOpenToolSchema;
export const folioManageToolSchema = workspacesManageToolSchema;
const htmlArtifactFrameSchemaValue = object({
  widthPx: { type: 'integer', minimum: 1, maximum: 8192 },
  heightPx: { type: 'integer', minimum: 1, maximum: 8192 },
  device: { enum: ['desktop', 'phone'] },
  theme: { enum: ['dark', 'light'] },
  reducedMotion: { type: 'boolean' },
  density: { enum: ['compact', 'comfortable', 'spacious'] },
  designTokens: {
    type: 'object',
    propertyNames: { pattern: '^--[a-z][a-z0-9-]{0,63}$' },
    additionalProperties: string(200, 1),
    maxProperties: 64,
  },
  fonts: object({ body: string(120, 1), heading: string(120, 1), mono: string(120, 1) }),
  layout: { enum: ['tiled', 'layered'] },
  pinned: { type: 'boolean' },
});
export const htmlArtifactFrameSchema = Object.freeze(htmlArtifactFrameSchemaValue);
export const webResearchResultSchema = Object.freeze(object({
  answer: string(20_000, 1),
  sources: array(webResearchSourceSchema, 10),
}));
const cell = { anyOf: [string(2_000), { type: 'number' }, { type: 'boolean' }, { type: 'null' }] };
const dataSchemas = {
  table: object({
    columns: array(string(80, 1), 20, 1),
    rows: array(array(cell, 20), rowLimit),
  }),
  list: object({ items: array(listItem, rowLimit) }),
  detail: object({
    fields: array(object({ label: string(100, 1), value: string(2_000) }), 100),
  }),
  text: object({ format: { type: 'string', enum: ['plain', 'markdown'] }, content: string(10_000) }),
  code: generatedCodeDataSchema,
  timeline: object({
    events: array({
      ...object({
        at: { anyOf: [
          { ...dateTime, pattern: '(?:[zZ]|[+-]\\d{2}:\\d{2})$' },
          { type: 'string', format: 'date' },
        ] },
        label: string(40, 1), title: string(200, 1), description: string(2_000),
      }, ['title']),
      anyOf: [{ required: ['at'] }, { required: ['label'] }],
    }, rowLimit),
  }),
  chart: object({
    kind: { type: 'string', enum: ['line', 'bar', 'area'] },
    series: array(object({
      name: string(100, 1),
      points: array(object({
        x: { anyOf: [{ type: 'number' }, string(200)] },
        y: { type: 'number' },
      }), 1_000),
    }), 5, 1),
  }),
  'task-card': object({
    id: string(64, 1), title: string(200, 1), state: string(50, 1), summary: string(2_000),
  }, ['id', 'title', 'state']),
  status: object({
    label: string(100, 1), value: string(500),
    state: { type: 'string', enum: ['ok', 'warning', 'error', 'unknown'] },
  }, ['label', 'state']),
  image: object({
    images: array(object({
      url: {
        type: 'string',
        format: 'uri',
        maxLength: 2_000,
        pattern: '^https://(?:github\\.com|(?:raw|avatars)\\.githubusercontent\\.com|[a-z0-9]{3,24}\\.blob\\.core\\.windows\\.net)(?:[/?#].*)?$',
      },
      alt: string(500, 1),
    }), 10),
  }),
  'html-app': object({
    artifactId: {
      type: 'string',
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    },
  }),
  'knowledge-graph': object({
    query: { ...string(500, 1), pattern: '\\S' },
    highlight: array({
      type: 'string',
      pattern: '^[0-9a-f]{64}$',
    }, 50),
  }),
};

export const generatedViewSchema = Object.freeze({
  oneOf: generatedViewRenderers.map((renderer) => object({
    version: { const: generatedViewVersion },
    title: string(200, 1),
    renderer: { const: renderer },
    source: sourceSchema,
    data: dataSchemas[renderer],
    actions: array(actionSchema, 10),
  }, ['version', 'title', 'renderer', 'source', 'data'])),
});

const workspaceCommandId = {
  ...string(128, 1),
  pattern: '^[A-Za-z0-9_-]{1,128}$',
};
export const workspaceViewIdSchema = {
  ...string(64, 1),
  pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$',
};
export const workspaceNavigationPages = Object.freeze([
  'home', 'factory', 'settings', 'usage', 'notes', 'knowledge', 'workspaces', 'folio', 'status', 'daily', 'health',
]);
export const workspaceSettingsSections = Object.freeze([
  'appearance', 'jarvis', 'personality', 'voice', 'presence', 'memory',
  'coding', 'projects', 'routines', 'credentials', 'backend',
]);
const workspaceWindowRegions = ['left', 'right', 'top', 'bottom', 'centre', 'full'];
const workspaceWindowPlacements = ['auto', 'region', 'manual'];
const workspaceArrangeLayouts = ['auto', 'side-by-side', 'grid', 'cascade'];
const workspaceLocationProperties = {
  page: { type: 'string', enum: [...workspaceNavigationPages] },
  section: { type: 'string', enum: [...workspaceSettingsSections] },
  taskId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$', maxLength: 19 },
  issueNumber: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
};
export const workspaceViewSchema = Object.freeze(object({
  ...workspaceLocationProperties,
  workspacesOpen: { type: 'boolean' },
  folioOpen: { type: 'boolean' },
  focusedViewId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$', maxLength: 128 },
  previous: object(workspaceLocationProperties, ['page']),
}, ['page']));

function isWorkspaceLocation(value, extraKeys = []) {
  return isObject(value) &&
    Object.keys(value).every((key) => ['page', 'section', 'taskId', 'issueNumber', ...extraKeys].includes(key)) &&
    workspaceNavigationPages.includes(value.page) &&
    (value.section === undefined || value.page === 'settings' && workspaceSettingsSections.includes(value.section)) &&
    (value.taskId === undefined || value.page === 'factory' && typeof value.taskId === 'string' && /^[1-9][0-9]{0,18}$/.test(value.taskId)) &&
    (value.issueNumber === undefined || value.page === 'factory' && Number.isSafeInteger(value.issueNumber) && value.issueNumber > 0);
}

export function isWorkspaceView(value) {
  return isWorkspaceLocation(value, ['workspacesOpen', 'folioOpen', 'focusedViewId', 'previous']) &&
    (value.workspacesOpen === undefined || typeof value.workspacesOpen === 'boolean') &&
    (value.folioOpen === undefined || typeof value.folioOpen === 'boolean') &&
    (value.focusedViewId === undefined || typeof value.focusedViewId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.focusedViewId)) &&
    (value.previous === undefined || isWorkspaceLocation(value.previous));
}

export const workspaceDeviceKinds = Object.freeze(['desktop', 'phone', 'tablet']);
export const workspaceCommandTargets = Object.freeze(['active', 'desktop', 'phone', 'all']);

function isWorkspaceDevice(value) {
  return isObject(value) && Object.keys(value).every((key) => ['kind', 'label'].includes(key)) &&
    workspaceDeviceKinds.includes(value.kind) &&
    (value.label === undefined || boundedString(value.label, 60, 1));
}

export function isWorkspaceSnapshot(value) {
  return isObject(value) &&
    Object.keys(value).every((key) => ['windows', 'contextPanelOpen', 'frame', 'view', 'device'].includes(key)) &&
    (value.device === undefined || isWorkspaceDevice(value.device)) &&
    Array.isArray(value.windows) && value.windows.length <= 32 &&
    value.windows.every((window) => isObject(window) &&
      Object.keys(window).every((key) =>
        ['viewId', 'title', 'state', 'placement', 'region', 'pinned', 'front', 'content', 'selection'].includes(key)) &&
      typeof window.viewId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(window.viewId) &&
      boundedString(window.title, 200, 1) &&
      (window.state === undefined || ['open', 'minimised'].includes(window.state)) &&
      (window.placement === undefined || workspaceWindowPlacements.includes(window.placement)) &&
      (!Object.hasOwn(window, 'region') ||
        window.placement === 'region' && workspaceWindowRegions.includes(window.region)) &&
      (window.pinned === undefined || typeof window.pinned === 'boolean') &&
      (window.front === undefined || typeof window.front === 'boolean') &&
      (window.content === undefined || typeof window.content === 'string' &&
        new TextEncoder().encode(window.content).byteLength <= 8 * 1024) &&
      (window.selection === undefined || typeof window.selection === 'string' &&
        new TextEncoder().encode(window.selection).byteLength <= 2 * 1024)) &&
    typeof value.contextPanelOpen === 'boolean' &&
    (value.frame === undefined || isHtmlArtifactFrame(value.frame)) &&
    (value.view === undefined || isWorkspaceView(value.view));
}

export const workspaceCommandSchema = Object.freeze({
  type: 'object',
  properties: {
    commandId: workspaceCommandId,
    target: { enum: workspaceCommandTargets },
    operation: { type: 'string', enum: ['create', 'update', 'show', 'close', 'minimise', 'restore', 'focus', 'move', 'resize', 'layout', 'context-panel', 'navigate', 'conversation', 'session', 'place', 'arrange', 'minimise-all', 'restore-all', 'close-all', 'pin', 'unpin'] },
    page: { type: 'string', enum: [...workspaceNavigationPages] },
    section: { type: 'string', enum: [...workspaceSettingsSections] },
    taskId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$', maxLength: 19 },
    issueNumber: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    viewId: workspaceViewIdSchema,
    region: { enum: workspaceWindowRegions },
    layout: { enum: workspaceArrangeLayouts },
    viewIds: { type: 'array', minItems: 1, maxItems: 8, items: workspaceViewIdSchema, uniqueItems: true },
    view: generatedViewSchema,
    x: { type: 'number', minimum: 0, maximum: 1 },
    y: { type: 'number', minimum: 0, maximum: 1 },
    width: { type: 'number', minimum: 0.32, maximum: 0.92 },
    height: { type: 'number', minimum: 0.34, maximum: 0.92 },
    arrangement: { enum: ['tiled', 'layered'] },
    action: { enum: ['open', 'close', 'toggle', 'show', 'hide', 'language', 'voice', 'camera'] },
    value: { type: 'string', enum: ['da', 'en', 'end', 'front', 'rear', 'off'] },
  },
  required: ['commandId', 'operation'],
  additionalProperties: false,
});

const routePattern = /^\/(?:$|factory\/tasks\/[1-9]\d{0,18}|factory\/(?:projects|releases)\/[1-9]\d{0,15}|usage|settings)(?:\?[^#]*)?$/;
const taskRoutePattern = /^\/factory\/tasks\/([1-9]\d{0,18})(?:\?[^#]*)?$/;
const linkHosts = new Set(['github.com', 'learn.microsoft.com']);
const imageHosts = new Set(['github.com', 'raw.githubusercontent.com', 'avatars.githubusercontent.com']);

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value, max, min = 0) {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function hasControlCharacters(value) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127;
  });
}

function isManagedProviderCause(value) {
  if (!isObject(value) || Object.keys(value).length === 0) return false;
  return Object.entries(value).every(([key, field]) => {
    if (key === 'httpStatus') return Number.isInteger(field) && field >= 100 && field <= 599;
    if (key === 'code' || key === 'param') {
      return typeof field === 'string' && /^[a-z0-9_.]{1,48}(?![\s\S])/u.test(field);
    }
    return key === 'exceptionType' && typeof field === 'string' &&
      /^[A-Za-z_][A-Za-z0-9_]{0,47}(?![\s\S])/u.test(field);
  });
}

export function isSystemSmokeStatus(value) {
  if (!isObject(value) || Object.keys(value).some((key) => !['checkedAt', 'entries'].includes(key)) ||
      !Array.isArray(value.entries) || value.entries.length !== systemSmokeCheckIds.length) return false;
  const validTime = (time) => {
    if (!boundedString(time, 30, 20) || !Number.isFinite(Date.parse(time))) return false;
    try { return new Date(time).toISOString() === time; } catch { return false; }
  };
  if (!validTime(value.checkedAt)) return false;
  return value.entries.every((entry, index) =>
    isObject(entry) &&
    Object.keys(entry).every((key) => ['id', 'status', 'checkedAt', 'reason', 'providerCause'].includes(key)) &&
    Object.keys(entry).length === 3 + (entry.reason === undefined ? 0 : 1) +
      (entry.providerCause === undefined ? 0 : 1) &&
    entry.id === systemSmokeCheckIds[index] &&
    ['ok', 'degraded', 'down', 'unknown'].includes(entry.status) &&
    (entry.reason === undefined ||
      (['degraded', 'down'].includes(entry.status) &&
        boundedString(entry.reason, 120, 1) && !hasControlCharacters(entry.reason))) &&
    (entry.providerCause === undefined ||
      (entry.id.startsWith('chat_') && entry.id !== 'chat_canary' &&
        ['managed_policy_turn_failed', 'managed_policy_setup_failed', 'managed_response_failed'].includes(entry.reason) &&
        isManagedProviderCause(entry.providerCause))) &&
    validTime(entry.checkedAt));
}

function safeHttpsUrl(value, hosts, trustedBlobHost) {
  if (!boundedString(value, 2_000, 1)) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const blobHostIsTrusted = typeof trustedBlobHost === 'string' &&
      /^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(trustedBlobHost);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (hosts.has(hostname) || (hosts === linkHosts &&
        (hostname === 'azure.com' || hostname.endsWith('.azure.com'))) ||
        (blobHostIsTrusted && hostname === trustedBlobHost));
  } catch {
    return false;
  }
}

function validAction(value, registeredTools) {
  if (!isObject(value) || !generatedViewActionTypes.includes(value.type)) return false;
  switch (value.type) {
    case 'open-route': {
      if (!boundedString(value.route, 200, 1)) return false;
      const taskRoute = taskRoutePattern.exec(value.route);
      return Object.keys(value).every((key) => ['type', 'route'].includes(key)) &&
        routePattern.test(value.route) && !value.route.includes('\\') &&
        (!taskRoute || BigInt(taskRoute[1]) <= maxSqlBigInt);
    }
    case 'open-link':
      return Object.keys(value).every((key) => ['type', 'url', 'label'].includes(key)) &&
        safeHttpsUrl(value.url, linkHosts) && boundedString(value.label, 200, 1);
    case 'call-tool':
      return Object.keys(value).every((key) => ['type', 'tool'].includes(key)) &&
        typeof value.tool === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.tool) &&
        (registeredTools === undefined || registeredTools.includes(value.tool));
    case 'window':
      return Object.keys(value).every((key) => ['type', 'operation', 'windowId', 'x', 'y', 'width', 'height'].includes(key)) &&
        boundedString(value.windowId, 64, 1) && (
          ['focus', 'minimise', 'restore', 'close'].includes(value.operation) &&
            !['x', 'y', 'width', 'height'].some((key) => key in value) ||
          value.operation === 'move' &&
            typeof value.x === 'number' && Number.isFinite(value.x) && value.x >= 0 && value.x <= 10_000 &&
            typeof value.y === 'number' && Number.isFinite(value.y) && value.y >= 0 && value.y <= 10_000 &&
            !['width', 'height'].some((key) => key in value) ||
          value.operation === 'resize' &&
            typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0 && value.width <= 10_000 &&
            typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0 && value.height <= 10_000 &&
            ['x', 'y'].every((key) => value[key] === undefined ||
              (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 10_000))
        );
    default:
      return false;
  }
}

function validTimelineDate(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[tT ](\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)([zZ]|([+-])(\d{2}):(\d{2})))?$/.exec(value);
  if (!match) return false;
  const date = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== match[1]) return false;
  if (match[2] === undefined) return true;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  if (hour > 23 || minute > 59 || offsetHour > 23 || offsetMinute > 59) return false;
  if (second < 60) return true;
  const sign = match[6] === '-' ? -1 : 1;
  const utcMinute = minute - offsetMinute * sign;
  const utcHour = hour - offsetHour * sign - (utcMinute < 0 ? 1 : 0);
  return second < 61 && (utcHour === 23 || utcHour === -1) && (utcMinute === 59 || utcMinute === -1);
}

function validSource(source) {
  if (!isObject(source) || ![
    'now', 'factory.tasks', 'factory.projects', 'usage', 'image_generation', 'html_generation', 'research', 'knowledge_graph',
  ].includes(source.id) ||
    !['running', 'complete', 'partial', 'unavailable'].includes(source.status) ||
    Object.keys(source).some((key) => !['id', 'status', 'updatedAt', 'reason', 'page'].includes(key))) return false;
  if (source.updatedAt !== undefined && (typeof source.updatedAt !== 'string' || Number.isNaN(Date.parse(source.updatedAt)))) return false;
  if (source.reason !== undefined && !boundedString(source.reason, 500)) return false;
  if (source.page !== undefined) {
    const { limit, offset, total, nextOffset } = source.page ?? {};
    if (!isObject(source.page) || Object.keys(source.page).some((key) => !['limit', 'offset', 'total', 'nextOffset'].includes(key)) ||
      !Number.isInteger(limit) || limit < 1 || limit > 1_000 ||
      !Number.isInteger(offset) || offset < 0 || offset > 10_000 ||
      (total !== undefined && (!Number.isInteger(total) || total < 0 || total > 1_000_000)) ||
      !(nextOffset === null || (Number.isInteger(nextOffset) && nextOffset >= 0 && nextOffset <= 10_000)) ||
      (nextOffset !== null && nextOffset !== offset + limit) ||
      (total !== undefined && (offset > total || (nextOffset !== null && nextOffset >= total) ||
        (nextOffset === null && offset + limit < total)))) return false;
  }
  return true;
}

function validData(renderer, data, trustedBlobHost) {
  if (!isObject(data)) return false;
  switch (renderer) {
    case 'table':
      return Object.keys(data).every((key) => ['columns', 'rows'].includes(key)) &&
        Array.isArray(data.columns) && data.columns.length > 0 && data.columns.length <= 20 &&
        data.columns.every((column) => boundedString(column, 80, 1)) &&
        Array.isArray(data.rows) && data.rows.length <= rowLimit &&
        data.rows.every((row) => Array.isArray(row) && row.length === data.columns.length &&
          row.every((cell) => cell === null || typeof cell === 'boolean' ||
            (typeof cell === 'number' && Number.isFinite(cell)) ||
            (typeof cell === 'string' && cell.length <= 2_000)));
    case 'list':
      return Object.keys(data).every((key) => key === 'items') && Array.isArray(data.items) &&
        data.items.length <= rowLimit && data.items.every((item) => isObject(item) &&
          Object.keys(item).every((key) => ['title', 'description', 'details', 'action'].includes(key)) &&
          boundedString(item.title, 200, 1) &&
          (item.description === undefined || boundedString(item.description, 2_000)) &&
          (item.details === undefined || (Array.isArray(item.details) && item.details.length <= 10 &&
            item.details.every((detail) => isObject(detail) &&
              Object.keys(detail).every((key) => ['label', 'value'].includes(key)) &&
              boundedString(detail.label, 100, 1) && boundedString(detail.value, 2_000)))) &&
          (item.action === undefined || (isObject(item.action) &&
            ['open-route', 'open-link'].includes(item.action.type) && validAction(item.action))));
    case 'detail':
      return Object.keys(data).every((key) => key === 'fields') && Array.isArray(data.fields) &&
        data.fields.length <= 100 && data.fields.every((field) => isObject(field) &&
          Object.keys(field).every((key) => ['label', 'value'].includes(key)) &&
          boundedString(field.label, 100, 1) && boundedString(field.value, 2_000));
    case 'text':
      return Object.keys(data).every((key) => ['format', 'content'].includes(key)) &&
        ['plain', 'markdown'].includes(data.format) && boundedString(data.content, 10_000);
    case 'timeline':
      return Object.keys(data).every((key) => key === 'events') && Array.isArray(data.events) &&
        data.events.length <= rowLimit && data.events.every((event) => isObject(event) &&
          Object.keys(event).every((key) => ['at', 'label', 'title', 'description'].includes(key)) &&
          (event.at !== undefined || event.label !== undefined) &&
          (event.at === undefined || validTimelineDate(event.at)) &&
          (event.label === undefined || typeof event.label === 'string' &&
            event.label.length > 0 && Array.from(event.label).length <= 40) &&
          boundedString(event.title, 200, 1) &&
          (event.description === undefined || boundedString(event.description, 2_000)));
    case 'chart': {
      if (Object.keys(data).some((key) => !['kind', 'series'].includes(key)) ||
        !['line', 'bar', 'area'].includes(data.kind) || !Array.isArray(data.series) ||
        data.series.length < 1 || data.series.length > 5) return false;
      let points = 0;
      for (const series of data.series) {
        if (!isObject(series) || Object.keys(series).some((key) => !['name', 'points'].includes(key)) ||
          !boundedString(series.name, 100, 1) || !Array.isArray(series.points)) return false;
        points += series.points.length;
        if (points > 1_000 || series.points.some((point) => !isObject(point) ||
          Object.keys(point).some((key) => !['x', 'y'].includes(key)) ||
          !((typeof point.x === 'number' && Number.isFinite(point.x)) || boundedString(point.x, 200)) ||
          typeof point.y !== 'number' || !Number.isFinite(point.y))) return false;
      }
      return true;
    }
    case 'task-card':
      return Object.keys(data).every((key) => ['id', 'title', 'state', 'summary'].includes(key)) &&
        boundedString(data.id, 64, 1) && boundedString(data.title, 200, 1) &&
        boundedString(data.state, 50, 1) &&
        (data.summary === undefined || boundedString(data.summary, 2_000));
    case 'status':
      return Object.keys(data).every((key) => ['label', 'value', 'state'].includes(key)) &&
        boundedString(data.label, 100, 1) && ['ok', 'warning', 'error', 'unknown'].includes(data.state) &&
        (data.value === undefined || boundedString(data.value, 500));
    case 'image':
      return Object.keys(data).every((key) => key === 'images') && Array.isArray(data.images) &&
        data.images.length <= 10 && data.images.every((image) => isObject(image) &&
          Object.keys(image).every((key) => ['url', 'alt'].includes(key)) &&
          safeHttpsUrl(image.url, imageHosts, trustedBlobHost) && boundedString(image.alt, 500, 1));
    case 'html-app':
      return Object.keys(data).length === 1 &&
        typeof data.artifactId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(data.artifactId);
    case 'knowledge-graph':
      return Object.keys(data).every((key) => ['query', 'highlight'].includes(key)) &&
        boundedString(data.query, 500, 1) && /\S/u.test(data.query) &&
        Array.isArray(data.highlight) && data.highlight.length <= 50 &&
        data.highlight.every((id) => typeof id === 'string' && /^[0-9a-f]{64}$/u.test(id)) &&
        new Set(data.highlight).size === data.highlight.length;
    case 'code':
      return isGeneratedCodeData(data);
    default:
      return false;
  }
}

export function isGeneratedCodeData(value) {
  if (!isObject(value) || Object.keys(value).some((key) =>
    !['repo', 'path', 'ref', 'language', 'content', 'startLine', 'highlight', 'query'].includes(key)) ||
    !boundedString(value.repo, 200, 1) || !/\S/u.test(value.repo) ||
    !boundedString(value.path, 2_048, 1) || !/\S/u.test(value.path) ||
    !boundedString(value.content, 200_000)) return false;
  for (const [key, limit] of [['ref', 200], ['language', 64], ['query', 500]]) {
    if (value[key] !== undefined && (!boundedString(value[key], limit, 1) || !/\S/u.test(value[key]))) return false;
  }
  const lineCount = value.content.split(/\r\n|\r|\n/u).length;
  const startLine = value.startLine ?? 1;
  const endLine = startLine + lineCount - 1;
  if (lineCount > 400 || !Number.isSafeInteger(startLine) || startLine < 1 ||
    !Number.isSafeInteger(endLine) || value.startLine === null) return false;
  return value.highlight === undefined || (Array.isArray(value.highlight) && value.highlight.length <= 400 &&
    value.highlight.every((range) => isObject(range) &&
      Object.keys(range).every((key) => ['from', 'to'].includes(key)) &&
      Number.isSafeInteger(range.from) && Number.isSafeInteger(range.to) &&
      range.from >= startLine && range.to >= range.from && range.to <= endLine));
}

export function isGeneratedView(value, options = {}) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return false;
  }
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > maxBytes ||
    !isObject(value) || Object.keys(value).some((key) =>
      !['version', 'title', 'renderer', 'source', 'data', 'actions'].includes(key))) return false;
  if (value.version !== generatedViewVersion || !generatedViewRenderers.includes(value.renderer) ||
    !boundedString(value.title, 200, 1) || !validSource(value.source) ||
    !validData(value.renderer, value.data, options.trustedBlobHost) ||
    (value.actions !== undefined && (!Array.isArray(value.actions) || value.actions.length > 10 ||
      !value.actions.every((action) => validAction(action, options.registeredTools))))) return false;
  return true;
}

export function isWebResearchResult(value) {
  if (!isObject(value) ||
    Object.keys(value).some((key) => !['answer', 'sources'].includes(key)) ||
    !boundedString(value.answer, 20_000, 1) ||
    !Array.isArray(value.sources) || value.sources.length > 10) return false;
  const urls = new Set();
  const containsAsciiControl = (text, includeSpace = false) =>
    Array.from(text).some((character) => {
      const code = character.charCodeAt(0);
      return code === 0x7f || code < (includeSpace ? 0x21 : 0x20);
    });
  return value.sources.every((source) => {
    if (!isObject(source) || Object.keys(source).some((key) => !['title', 'url', 'retrievedAt'].includes(key)) ||
      !boundedString(source.title, 200, 1) || source.title !== source.title.trim() ||
      containsAsciiControl(source.title) ||
      !boundedString(source.url, 2_048, 1) || source.url !== source.url.trim() ||
      containsAsciiControl(source.url, true) ||
      typeof source.retrievedAt !== 'string' || !Number.isFinite(Date.parse(source.retrievedAt))) return false;
    try {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(source.retrievedAt) ||
        new Date(source.retrievedAt).toISOString() !== source.retrievedAt ||
        urls.has(url.href)) return false;
      urls.add(url.href);
      return true;
    } catch {
      return false;
    }
  });
}

function validHtml(value) {
  if (!boundedString(value, htmlArtifactByteLimit, 1) ||
      new TextEncoder().encode(value).byteLength > htmlArtifactByteLimit ||
      /<base\b/i.test(value) || /<script\b[^>]*\bsrc\s*=/i.test(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validIsoDateTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function isWorkspaceItem(value) {
  return isObject(value) && Object.keys(value).length === 6 &&
    /^[a-z_]+:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value.id) &&
    workspaceItemKinds.includes(value.kind) && value.id.startsWith(`${value.kind}:`) &&
    boundedString(value.title, 200, 1) && value.title === value.title.trim() &&
    validIsoDateTime(value.createdAt) && boundedString(value.promptSummary, 500, 1) &&
    value.promptSummary === value.promptSummary.trim() && typeof value.pinned === 'boolean';
}
export const isFolioItem = isWorkspaceItem;

export function isHtmlArtifact(value) {
  if (!isObject(value) || Object.keys(value).some((key) =>
    !['id', 'kind', 'title', 'html', 'sources', 'createdAt', 'pinned'].includes(key)) ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.id) ||
    value.kind !== 'html' || !boundedString(value.title, 200, 1) ||
    value.title !== value.title.trim() || !validHtml(value.html) ||
    !Array.isArray(value.sources) || value.sources.length > 50 ||
    !validIsoDateTime(value.createdAt) ||
    typeof value.pinned !== 'boolean') return false;
  const urls = new Set();
  return value.sources.every((source) => {
    if (!isObject(source) || Object.keys(source).some((key) => !['title', 'url'].includes(key)) ||
        !boundedString(source.title, 200, 1) || source.title !== source.title.trim() ||
        !boundedString(source.url, 2_048, 1) || source.url !== source.url.trim()) return false;
    try {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port ||
          urls.has(url.href)) return false;
      urls.add(url.href);
      return true;
    } catch {
      return false;
    }
  });
}

export function isHtmlArtifactFrame(value) {
  if (!isObject(value) ||
      Object.keys(value).some((key) => ![
        'widthPx', 'heightPx', 'device', 'theme', 'reducedMotion', 'density',
        'designTokens', 'fonts', 'layout', 'pinned',
      ].includes(key)) ||
      !Number.isInteger(value.widthPx) || value.widthPx < 1 || value.widthPx > 8192 ||
      !Number.isInteger(value.heightPx) || value.heightPx < 1 || value.heightPx > 8192 ||
      !['desktop', 'phone'].includes(value.device) || !['dark', 'light'].includes(value.theme) ||
      typeof value.reducedMotion !== 'boolean' ||
      !['compact', 'comfortable', 'spacious'].includes(value.density) ||
      !isObject(value.designTokens) || Object.keys(value.designTokens).length > 64 ||
      Object.entries(value.designTokens).some(([key, token]) =>
        !/^--[a-z][a-z0-9-]{0,63}$/.test(key) || !boundedString(token, 200, 1)) ||
      !isObject(value.fonts) || Object.keys(value.fonts).length !== 3 ||
      !['body', 'heading', 'mono'].every((key) => boundedString(value.fonts[key], 120, 1)) ||
      Object.keys(value.fonts).some((key) => !['body', 'heading', 'mono'].includes(key)) ||
      !['tiled', 'layered'].includes(value.layout) || typeof value.pinned !== 'boolean') return false;
  return true;
}

export function isValidHtmlArtifactHtml(value) {
  return validHtml(value);
}

export const workspacePinSchema = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    viewId: workspaceViewIdSchema,
    view: generatedViewSchema,
    pinnedAt: dateTime,
  }),
  required: Object.freeze(['viewId', 'view', 'pinnedAt']),
  additionalProperties: false,
});

export const workspacePinPutSchema = Object.freeze({
  type: 'object',
  properties: Object.freeze({ view: generatedViewSchema }),
  required: Object.freeze(['view']),
  additionalProperties: false,
});

export const workspacePinResponseSchema = Object.freeze({
  type: 'object',
  properties: Object.freeze({ pin: workspacePinSchema }),
  required: Object.freeze(['pin']),
  additionalProperties: false,
});

export const workspacePinsResponseSchema = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    pins: Object.freeze({ type: 'array', maxItems: 20, items: workspacePinSchema }),
  }),
  required: Object.freeze(['pins']),
  additionalProperties: false,
});

export function isWorkspacePin(value, options = {}) {
  return isObject(value) && Object.keys(value).length === 3 &&
    typeof value.viewId === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.viewId) &&
    isGeneratedView(value.view, options) && validIsoDateTime(value.pinnedAt);
}

export function isWorkspacePinsResponse(value, options = {}) {
  return isObject(value) && Object.keys(value).length === 1 &&
    Array.isArray(value.pins) && value.pins.length <= 20 && value.pins.every((pin) => isWorkspacePin(pin, options));
}

export function isWorkspaceCommand(value, options = {}) {
  if (!isObject(value) ||
    typeof value.commandId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.commandId)) return false;
  const hasOnly = (...keys) => Object.keys(value).every((key) => ['commandId', 'operation', 'target', ...keys].includes(key));
  if (value.target !== undefined && !workspaceCommandTargets.includes(value.target)) return false;
  switch (value.operation) {
    case 'navigate':
      return hasOnly('page', 'section', 'taskId', 'issueNumber') && workspaceNavigationPages.includes(value.page) &&
        (value.section === undefined ||
          value.page === 'settings' && workspaceSettingsSections.includes(value.section)) &&
        (value.taskId === undefined || value.page === 'factory' && isTaskEventId(value.taskId)) &&
        (value.issueNumber === undefined ||
          value.page === 'factory' && Number.isSafeInteger(value.issueNumber) && value.issueNumber > 0);
    case 'conversation':
      return hasOnly('action') && ['show', 'hide'].includes(value.action);
    case 'session':
      return hasOnly('action', 'value') && (
        value.action === 'language' && ['da', 'en'].includes(value.value) ||
        value.action === 'voice' && value.value === 'end' ||
        value.action === 'camera' && ['front', 'rear', 'off'].includes(value.value));
    case 'create':
    case 'update':
      return hasOnly('viewId', 'view') &&
        typeof value.viewId === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.viewId) &&
        isGeneratedView(value.view, options);
    case 'show':
    case 'close':
    case 'minimise':
    case 'restore':
    case 'focus':
      return hasOnly('viewId') &&
        typeof value.viewId === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.viewId);
    case 'place':
      return hasOnly('viewId', 'region') &&
        typeof value.viewId === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.viewId) &&
        workspaceWindowRegions.includes(value.region);
    case 'arrange':
      return hasOnly('layout', 'viewIds') && workspaceArrangeLayouts.includes(value.layout) &&
        (value.viewIds === undefined || Array.isArray(value.viewIds) && value.viewIds.length >= 1 &&
          value.viewIds.length <= 8 &&
          value.viewIds.every((viewId) => typeof viewId === 'string' &&
            /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(viewId)) &&
          new Set(value.viewIds).size === value.viewIds.length);
    case 'minimise-all':
    case 'restore-all':
    case 'close-all':
      return hasOnly();
    case 'pin':
    case 'unpin':
      return hasOnly('viewId') &&
        typeof value.viewId === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.viewId);
    case 'move':
      return hasOnly('viewId', 'x', 'y') &&
        typeof value.viewId === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.viewId) &&
        Number.isFinite(value.x) && value.x >= 0 && value.x <= 1 &&
        Number.isFinite(value.y) && value.y >= 0 && value.y <= 1;
    case 'resize':
      return hasOnly('viewId', 'width', 'height', 'x', 'y') &&
        typeof value.viewId === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.viewId) &&
        Number.isFinite(value.width) && value.width >= 0.32 && value.width <= 0.92 &&
        Number.isFinite(value.height) && value.height >= 0.34 && value.height <= 0.92 &&
        (value.x === undefined || (Number.isFinite(value.x) && value.x >= 0 && value.x + value.width <= 1)) &&
        (value.y === undefined || (Number.isFinite(value.y) && value.y >= 0 && value.y + value.height <= 1));
    case 'layout':
      return hasOnly('arrangement') && ['tiled', 'layered'].includes(value.arrangement);
    case 'context-panel':
      return value.action === 'open'
        ? hasOnly('action', 'view') && (value.view === undefined || isGeneratedView(value.view, options))
        : ['close', 'toggle'].includes(value.action) && hasOnly('action');
    default:
      return false;
  }
}

const workspaceProblemLimit = 3;
const workspaceViewIdPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const workspaceViewIdHint = 'must start with a letter, then letters, digits, _ or - (up to 64 characters)';
const operationShape = (keys, required = keys) => Object.freeze({ keys, required });
const workspaceOperationShapes = Object.freeze({
  create: operationShape(['viewId', 'view']),
  update: operationShape(['viewId', 'view']),
  show: operationShape(['viewId']),
  close: operationShape(['viewId']),
  minimise: operationShape(['viewId']),
  restore: operationShape(['viewId']),
  focus: operationShape(['viewId']),
  move: operationShape(['viewId', 'x', 'y']),
  resize: operationShape(['viewId', 'width', 'height', 'x', 'y'], ['viewId', 'width', 'height']),
  layout: operationShape(['arrangement']),
  'context-panel': operationShape(['action', 'view'], ['action']),
  navigate: operationShape(['page', 'section', 'taskId', 'issueNumber'], ['page']),
  conversation: operationShape(['action']),
  session: operationShape(['action', 'value']),
  place: operationShape(['viewId', 'region']),
  arrange: operationShape(['layout', 'viewIds'], ['layout']),
  'minimise-all': operationShape([]),
  'restore-all': operationShape([]),
  'close-all': operationShape([]),
  pin: operationShape(['viewId']),
  unpin: operationShape(['viewId']),
});
const workspaceActionValues = Object.freeze({
  conversation: ['show', 'hide'], session: ['language', 'voice', 'camera'], 'context-panel': ['open', 'close', 'toggle'],
});
const workspaceSessionValues = Object.freeze({ language: ['da', 'en'], voice: ['end'], camera: ['front', 'rear', 'off'] });
const generatedViewKeys = Object.freeze(['version', 'title', 'renderer', 'source', 'data', 'actions']);
const generatedSourceKeys = Object.freeze(['id', 'status', 'updatedAt', 'reason', 'page']);
const generatedViewExample =
  '{"version":1,"title":"...","renderer":"list","source":{"id":"now","status":"complete"},"data":{"items":[{"title":"..."}]}}';
const generatedDataShapes = Object.freeze({
  table: { example: '{"columns":["A","B"],"rows":[["x","y"]]}', keys: ['columns', 'rows'], required: ['columns', 'rows'] },
  list: { example: '{"items":[{"title":"..."}]}', keys: ['items'], required: ['items'] },
  detail: { example: '{"fields":[{"label":"...","value":"..."}]}', keys: ['fields'], required: ['fields'] },
  text: { example: '{"format":"plain","content":"..."}', keys: ['format', 'content'], required: ['format', 'content'] },
  timeline: { example: '{"events":[{"at":"2026-01-31","title":"..."}]}', keys: ['events'], required: ['events'] },
  chart: {
    example: '{"kind":"line","series":[{"name":"...","points":[{"x":1,"y":2}]}]}',
    keys: ['kind', 'series'], required: ['kind', 'series'],
  },
  'task-card': {
    example: '{"id":"...","title":"...","state":"..."}',
    keys: ['id', 'title', 'state', 'summary'], required: ['id', 'title', 'state'],
  },
  status: { example: '{"label":"...","state":"ok"}', keys: ['label', 'value', 'state'], required: ['label', 'state'] },
  image: { example: '{"images":[{"url":"https://...","alt":"..."}]}', keys: ['images'], required: ['images'] },
  'html-app': { example: '{"artifactId":"<id of an existing HTML app>"}', keys: ['artifactId'], required: ['artifactId'] },
  'knowledge-graph': {
    example: '{"query":"...","highlight":[]}', keys: ['query', 'highlight'], required: ['query', 'highlight'],
  },
  code: {
    example: '{"repo":"owner/name","path":"src/file.ts","content":"..."}',
    keys: ['repo', 'path', 'ref', 'language', 'content', 'startLine', 'highlight', 'query'],
    required: ['repo', 'path', 'content'],
  },
});

function listText(values, joiner = 'or') {
  return values.length < 2 ? values.join('') : `${values.slice(0, -1).join(', ')} ${joiner} ${values[values.length - 1]}`;
}

const requiredText = (value) => value === undefined ? 'is required, and ' : '';
const countText = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function stringProblem(value, min, max) {
  return boundedString(value, max, min) ? undefined
    : `${requiredText(value)}must be a string of ${min > 0 ? `${min}-${max}` : `at most ${max}`} characters`;
}

function addWorkspaceProblem(problems, path, problem) {
  if (problem !== undefined && problems.length < workspaceProblemLimit) problems.push({ path, problem });
}

function eachWorkspaceItem(items, problems, visit) {
  for (let index = 0; index < items.length && problems.length < workspaceProblemLimit; index += 1) visit(items[index], index);
}

function workspaceFieldProblem(command, key) {
  const value = command[key];
  const range = (min, max) => Number.isFinite(value) && value >= min && value <= max
    ? undefined : `must be a number from ${min} to ${max}`;
  switch (key) {
    case 'viewId':
      return typeof value === 'string' && workspaceViewIdPattern.test(value) ? undefined : workspaceViewIdHint;
    case 'viewIds':
      return Array.isArray(value) && value.length >= 1 && value.length <= 8 && new Set(value).size === value.length &&
        value.every((id) => typeof id === 'string' && workspaceViewIdPattern.test(id))
        ? undefined : 'must be an array of 1-8 different view ids';
    case 'region':
      return workspaceWindowRegions.includes(value) ? undefined : `must be one of ${listText(workspaceWindowRegions)}`;
    case 'layout':
      return workspaceArrangeLayouts.includes(value) ? undefined : `must be one of ${listText(workspaceArrangeLayouts)}`;
    case 'arrangement':
      return ['tiled', 'layered'].includes(value) ? undefined : 'must be tiled or layered';
    case 'page':
      return workspaceNavigationPages.includes(value) ? undefined : `must be one of ${listText(workspaceNavigationPages)}`;
    case 'section':
      if (command.page !== 'settings') return 'is only allowed with page settings';
      return workspaceSettingsSections.includes(value) ? undefined : `must be one of ${listText(workspaceSettingsSections)}`;
    case 'taskId':
      if (command.page !== 'factory') return 'is only allowed with page factory';
      return isTaskEventId(value) ? undefined : 'must be a task id: up to 19 digits, not starting with 0';
    case 'issueNumber':
      if (command.page !== 'factory') return 'is only allowed with page factory';
      return Number.isSafeInteger(value) && value > 0 ? undefined : 'must be a positive whole number';
    case 'width':
      return range(0.32, 0.92);
    case 'height':
      return range(0.34, 0.92);
    case 'x':
    case 'y': {
      if (command.operation === 'move') return range(0, 1);
      if (!Number.isFinite(value) || value < 0) return 'must be a number of at least 0';
      const size = command[key === 'x' ? 'width' : 'height'];
      return Number.isFinite(size) && value + size > 1
        ? `must leave room for ${key === 'x' ? 'width' : 'height'} (${key} plus ${key === 'x' ? 'width' : 'height'} must not exceed 1)`
        : undefined;
    }
    case 'action': {
      const actions = workspaceActionValues[command.operation];
      return actions.includes(value) ? undefined : `must be ${listText(actions)}`;
    }
    case 'value': {
      const values = typeof command.action === 'string' && Object.hasOwn(workspaceSessionValues, command.action)
        ? workspaceSessionValues[command.action] : undefined;
      return values === undefined || values.includes(value)
        ? undefined : `must be ${listText(values)} for action ${command.action}`;
    }
    default:
      return undefined;
  }
}

function generatedActionProblems(action, path, problems, options, listItem = false) {
  const types = listItem ? ['open-route', 'open-link'] : generatedViewActionTypes;
  if (!isObject(action)) {
    addWorkspaceProblem(problems, path, `must be an object whose type is one of ${listText(types)}`);
    return;
  }
  if (!types.includes(action.type)) {
    addWorkspaceProblem(problems, `${path}.type`, `${requiredText(action.type)}must be one of ${listText(types)}`);
    return;
  }
  const keys = {
    'open-route': ['type', 'route'], 'open-link': ['type', 'url', 'label'], 'call-tool': ['type', 'tool'],
    window: ['type', 'operation', 'windowId', 'x', 'y', 'width', 'height'],
  }[action.type];
  if (Object.keys(action).some((key) => !keys.includes(key))) {
    addWorkspaceProblem(problems, path, `has an unexpected property, and ${action.type} takes ${listText(keys, 'and')} only`);
  }
  if (action.type === 'open-route' && !validAction({ type: 'open-route', route: action.route })) {
    addWorkspaceProblem(problems, `${path}.route`,
      'must be /, /usage, /settings, /factory/tasks/<id>, /factory/projects/<id> or /factory/releases/<id>');
  } else if (action.type === 'open-link') {
    if (!safeHttpsUrl(action.url, linkHosts)) {
      addWorkspaceProblem(problems, `${path}.url`,
        `${requiredText(action.url)}must be an https link on github.com, learn.microsoft.com, azure.com or *.azure.com, with no port or login details`);
    }
    addWorkspaceProblem(problems, `${path}.label`, stringProblem(action.label, 1, 200));
  } else if (action.type === 'call-tool') {
    if (typeof action.tool !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(action.tool)) {
      addWorkspaceProblem(problems, `${path}.tool`,
        `${requiredText(action.tool)}must be a tool name of 1-64 letters, digits, _ or -`);
    } else if (options.registeredTools !== undefined && !options.registeredTools.includes(action.tool)) {
      addWorkspaceProblem(problems, `${path}.tool`,
        'is not a registered tool (use an exact tool name from your tool list, or leave the action out)');
    }
  } else if (action.type === 'window' && !validAction(action)) {
    addWorkspaceProblem(problems, path,
      'is not a valid window action (it needs windowId and an operation of focus, minimise, restore, close, move or resize)');
  }
}

function generatedSourceProblems(source, problems) {
  if (!isObject(source)) {
    addWorkspaceProblem(problems, 'view.source',
      `${requiredText(source)}must be an object like {"id":"now","status":"complete"}`);
    return;
  }
  const ids = sourceSchema.properties.id.enum;
  if (Object.keys(source).some((key) => !generatedSourceKeys.includes(key))) {
    addWorkspaceProblem(problems, 'view.source', `has an unexpected property, and takes ${listText(generatedSourceKeys, 'and')} only`);
  }
  if (!ids.includes(source.id)) {
    addWorkspaceProblem(problems, 'view.source.id',
      `${requiredText(source.id)}must be one of ${listText(ids)} (use now when none of the others fit)`);
  }
  if (!['complete', 'partial', 'unavailable'].includes(source.status)) {
    addWorkspaceProblem(problems, 'view.source.status', `${requiredText(source.status)}must be complete, partial or unavailable`);
  }
  if (source.updatedAt !== undefined && (typeof source.updatedAt !== 'string' || Number.isNaN(Date.parse(source.updatedAt)) ||
    !/^\d{4}-\d{2}-\d{2}[tT ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/.test(source.updatedAt))) {
    addWorkspaceProblem(problems, 'view.source.updatedAt',
      'must be an ISO date-time with a timezone such as 2026-01-31T09:00:00Z, or left out');
  }
  if (source.reason !== undefined && !boundedString(source.reason, 500)) {
    addWorkspaceProblem(problems, 'view.source.reason', 'must be a string of at most 500 characters');
  }
  if (source.page !== undefined && !validSource({ id: 'now', status: 'complete', page: source.page })) {
    addWorkspaceProblem(problems, 'view.source.page',
      'must have integer limit (1-1000), offset (0-10000), nextOffset (null, or offset plus limit) and an optional total that agrees with them');
  }
}

function generatedLabelValueProblems(entry, path, problems) {
  if (!isObject(entry)) {
    addWorkspaceProblem(problems, path, 'must be an object like {"label":"...","value":"..."}');
    return;
  }
  if (Object.keys(entry).some((key) => !['label', 'value'].includes(key))) {
    addWorkspaceProblem(problems, path, 'has an unexpected property, and takes label and value only');
  }
  addWorkspaceProblem(problems, `${path}.label`, stringProblem(entry.label, 1, 100));
  addWorkspaceProblem(problems, `${path}.value`, stringProblem(entry.value, 0, 2_000));
}

function generatedListItemProblems(item, path, problems, options) {
  if (!isObject(item)) {
    addWorkspaceProblem(problems, path, 'must be an object like {"title":"..."}');
    return;
  }
  if (Object.keys(item).some((key) => !['title', 'description', 'details', 'action'].includes(key))) {
    addWorkspaceProblem(problems, path, 'has an unexpected property, and takes title, description, details and action only');
  }
  addWorkspaceProblem(problems, `${path}.title`, stringProblem(item.title, 1, 200));
  if (item.description !== undefined) addWorkspaceProblem(problems, `${path}.description`, stringProblem(item.description, 0, 2_000));
  if (item.details !== undefined) {
    if (!Array.isArray(item.details) || item.details.length > 10) {
      addWorkspaceProblem(problems, `${path}.details`, 'must be an array of at most 10 {"label","value"} objects');
    } else {
      eachWorkspaceItem(item.details, problems, (detail, index) =>
        generatedLabelValueProblems(detail, `${path}.details[${index}]`, problems));
    }
  }
  if (item.action !== undefined) generatedActionProblems(item.action, `${path}.action`, problems, options, true);
}

function generatedDataProblems(renderer, data, options, problems) {
  const shape = generatedDataShapes[renderer];
  if (!isObject(data) || Object.keys(data).some((key) => !shape.keys.includes(key)) ||
    shape.required.some((key) => data[key] === undefined)) {
    addWorkspaceProblem(problems, 'view.data', `for renderer ${renderer} must look like ${shape.example}`);
    return;
  }
  const path = 'view.data';
  const collection = (key, max, noun) => {
    if (Array.isArray(data[key]) && data[key].length <= max) return true;
    addWorkspaceProblem(problems, `${path}.${key}`, `must be an array of at most ${max} ${noun}`);
    return false;
  };
  switch (renderer) {
    case 'table': {
      const { columns, rows } = data;
      const columnCount = Array.isArray(columns) && columns.length >= 1 && columns.length <= 20 ? columns.length : undefined;
      if (columnCount === undefined) addWorkspaceProblem(problems, `${path}.columns`, 'must be an array of 1-20 column labels');
      else eachWorkspaceItem(columns, problems, (column, index) =>
        addWorkspaceProblem(problems, `${path}.columns[${index}]`, stringProblem(column, 1, 80)));
      if (collection('rows', rowLimit, 'rows') && columnCount !== undefined) {
        eachWorkspaceItem(rows, problems, (row, index) => {
          const rowPath = `${path}.rows[${index}]`;
          if (!Array.isArray(row)) {
            addWorkspaceProblem(problems, rowPath, 'must be an array of cells');
          } else if (row.length !== columnCount) {
            addWorkspaceProblem(problems, rowPath,
              `has ${countText(row.length, 'cell')} but there ${columnCount === 1 ? 'is' : 'are'} ${countText(columnCount, 'column')}, so give every row exactly one cell per column`);
          } else {
            eachWorkspaceItem(row, problems, (cell, cellIndex) => {
              if (!(cell === null || typeof cell === 'boolean' || (typeof cell === 'number' && Number.isFinite(cell)) ||
                (typeof cell === 'string' && cell.length <= 2_000))) {
                addWorkspaceProblem(problems, `${rowPath}[${cellIndex}]`,
                  'must be a string of at most 2000 characters, a number, a boolean or null');
              }
            });
          }
        });
      }
      break;
    }
    case 'list':
      if (collection('items', rowLimit, 'items')) {
        eachWorkspaceItem(data.items, problems, (item, index) =>
          generatedListItemProblems(item, `${path}.items[${index}]`, problems, options));
      }
      break;
    case 'detail':
      if (collection('fields', 100, 'fields')) {
        eachWorkspaceItem(data.fields, problems, (field, index) =>
          generatedLabelValueProblems(field, `${path}.fields[${index}]`, problems));
      }
      break;
    case 'text':
      if (!['plain', 'markdown'].includes(data.format)) addWorkspaceProblem(problems, `${path}.format`, 'must be plain or markdown');
      addWorkspaceProblem(problems, `${path}.content`, stringProblem(data.content, 0, 10_000));
      break;
    case 'timeline':
      if (collection('events', rowLimit, 'events')) {
        eachWorkspaceItem(data.events, problems, (event, index) => {
          const eventPath = `${path}.events[${index}]`;
          if (!isObject(event)) {
            addWorkspaceProblem(problems, eventPath, 'must be an object like {"at":"2026-01-31","title":"..."}');
            return;
          }
          if (Object.keys(event).some((key) => !['at', 'label', 'title', 'description'].includes(key))) {
            addWorkspaceProblem(problems, eventPath, 'has an unexpected property, and takes at, label, title and description only');
          }
          if (event.at === undefined && event.label === undefined) addWorkspaceProblem(problems, eventPath, 'needs at or label');
          if (event.at !== undefined && !validTimelineDate(event.at)) {
            addWorkspaceProblem(problems, `${eventPath}.at`,
              'must be a real date such as 2026-01-31 or a date-time with a timezone such as 2026-01-31T09:00:00Z (use label for a period)');
          }
          if (event.label !== undefined && !(typeof event.label === 'string' && event.label.length > 0 &&
            Array.from(event.label).length <= 40)) {
            addWorkspaceProblem(problems, `${eventPath}.label`, 'must be a string of 1-40 characters');
          }
          addWorkspaceProblem(problems, `${eventPath}.title`, stringProblem(event.title, 1, 200));
          if (event.description !== undefined) {
            addWorkspaceProblem(problems, `${eventPath}.description`, stringProblem(event.description, 0, 2_000));
          }
        });
      }
      break;
    case 'chart': {
      if (!['line', 'bar', 'area'].includes(data.kind)) addWorkspaceProblem(problems, `${path}.kind`, 'must be line, bar or area');
      if (!Array.isArray(data.series) || data.series.length < 1 || data.series.length > 5) {
        addWorkspaceProblem(problems, `${path}.series`, 'must be an array of 1-5 series');
        break;
      }
      let points = 0;
      eachWorkspaceItem(data.series, problems, (series, index) => {
        const seriesPath = `${path}.series[${index}]`;
        if (!isObject(series)) {
          addWorkspaceProblem(problems, seriesPath, 'must be an object like {"name":"...","points":[{"x":1,"y":2}]}');
          return;
        }
        if (Object.keys(series).some((key) => !['name', 'points'].includes(key))) {
          addWorkspaceProblem(problems, seriesPath, 'has an unexpected property, and takes name and points only');
        }
        addWorkspaceProblem(problems, `${seriesPath}.name`, stringProblem(series.name, 1, 100));
        if (!Array.isArray(series.points)) {
          addWorkspaceProblem(problems, `${seriesPath}.points`, 'must be an array of {"x","y"} points');
          return;
        }
        points += series.points.length;
        eachWorkspaceItem(series.points, problems, (point, pointIndex) => {
          if (!isObject(point) || Object.keys(point).some((key) => !['x', 'y'].includes(key)) ||
            !((typeof point.x === 'number' && Number.isFinite(point.x)) || boundedString(point.x, 200)) ||
            typeof point.y !== 'number' || !Number.isFinite(point.y)) {
            addWorkspaceProblem(problems, `${seriesPath}.points[${pointIndex}]`,
              'must be {"x": a number or a string of at most 200 characters, "y": a number}');
          }
        });
      });
      if (points > 1_000) addWorkspaceProblem(problems, `${path}.series`, 'has more than 1000 points in total');
      break;
    }
    case 'task-card':
      addWorkspaceProblem(problems, `${path}.id`, stringProblem(data.id, 1, 64));
      addWorkspaceProblem(problems, `${path}.title`, stringProblem(data.title, 1, 200));
      addWorkspaceProblem(problems, `${path}.state`, stringProblem(data.state, 1, 50));
      if (data.summary !== undefined) addWorkspaceProblem(problems, `${path}.summary`, stringProblem(data.summary, 0, 2_000));
      break;
    case 'status':
      addWorkspaceProblem(problems, `${path}.label`, stringProblem(data.label, 1, 100));
      if (!['ok', 'warning', 'error', 'unknown'].includes(data.state)) {
        addWorkspaceProblem(problems, `${path}.state`, 'must be ok, warning, error or unknown');
      }
      if (data.value !== undefined) addWorkspaceProblem(problems, `${path}.value`, stringProblem(data.value, 0, 500));
      break;
    case 'image':
      if (collection('images', 10, 'images')) {
        eachWorkspaceItem(data.images, problems, (image, index) => {
          const imagePath = `${path}.images[${index}]`;
          if (!isObject(image)) {
            addWorkspaceProblem(problems, imagePath, 'must be an object like {"url":"https://...","alt":"..."}');
            return;
          }
          if (Object.keys(image).some((key) => !['url', 'alt'].includes(key))) {
            addWorkspaceProblem(problems, imagePath, 'has an unexpected property, and takes url and alt only');
          }
          if (!safeHttpsUrl(image.url, imageHosts, options.trustedBlobHost)) {
            addWorkspaceProblem(problems, `${imagePath}.url`,
              `${requiredText(image.url)}must be an https link on github.com, raw.githubusercontent.com, avatars.githubusercontent.com or the trusted image storage host`);
          }
          addWorkspaceProblem(problems, `${imagePath}.alt`, stringProblem(image.alt, 1, 500));
        });
      }
      break;
    case 'html-app':
      if (!validData(renderer, data)) addWorkspaceProblem(problems, `${path}.artifactId`, 'must be the id (a UUID) of an existing HTML app');
      break;
    case 'knowledge-graph':
      if (!boundedString(data.query, 500, 1) || !/\S/u.test(data.query)) {
        addWorkspaceProblem(problems, `${path}.query`, 'must be a non-blank string of 1-500 characters');
      }
      if (!Array.isArray(data.highlight) || data.highlight.length > 50 ||
        !data.highlight.every((id) => typeof id === 'string' && /^[0-9a-f]{64}$/u.test(id)) ||
        new Set(data.highlight).size !== data.highlight.length) {
        addWorkspaceProblem(problems, `${path}.highlight`, 'must be an array of at most 50 different node ids (64 hex characters each)');
      }
      break;
    default:
      if (!isGeneratedCodeData(data)) {
        addWorkspaceProblem(problems, path, 'is not valid code data (repo, path and content are required, and content is at most 400 lines)');
      }
  }
}

function generatedViewProblems(view, options, problems) {
  if (!isObject(view)) {
    addWorkspaceProblem(problems, 'view', `${requiredText(view)}must be a JSON object${typeof view === 'string' ? ', not text containing JSON,' : ''} like ${generatedViewExample}`);
    return;
  }
  let bytes;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(view)).byteLength;
  } catch {
    addWorkspaceProblem(problems, 'view', 'must contain plain JSON data only');
    return;
  }
  if (bytes > maxBytes) {
    addWorkspaceProblem(problems, 'view', 'is larger than 256 KiB, so send fewer rows or shorter text');
    return;
  }
  const before = problems.length;
  if (Object.keys(view).some((key) => !generatedViewKeys.includes(key))) {
    addWorkspaceProblem(problems, 'view', `has an unexpected property, and takes ${listText(generatedViewKeys, 'and')} only`);
  }
  if (view.version !== generatedViewVersion) addWorkspaceProblem(problems, 'view.version', `${requiredText(view.version)}must be the number 1`);
  const renderer = generatedViewRenderers.includes(view.renderer) ? view.renderer : undefined;
  if (renderer === undefined) {
    addWorkspaceProblem(problems, 'view.renderer', `${requiredText(view.renderer)}must be one of ${listText(generatedViewRenderers)}`);
  }
  addWorkspaceProblem(problems, 'view.title', stringProblem(view.title, 1, 200));
  generatedSourceProblems(view.source, problems);
  if (renderer !== undefined) generatedDataProblems(renderer, view.data, options, problems);
  if (view.actions !== undefined) {
    if (!Array.isArray(view.actions) || view.actions.length > 10) {
      addWorkspaceProblem(problems, 'view.actions', 'must be an array of at most 10 actions');
    } else {
      eachWorkspaceItem(view.actions, problems, (action, index) =>
        generatedActionProblems(action, `view.actions[${index}]`, problems, options));
    }
  }
  if (problems.length === before && !isGeneratedView(view, options)) {
    addWorkspaceProblem(problems, 'view', 'does not match the contract for its renderer');
  }
}

/**
 * Explains why `isWorkspaceCommand(value, options)` rejects a command (or why the tool schema would), as up to
 * three `{ path, problem }` entries. Paths are known property names and array indexes; problems are static text,
 * enumerations and counts. It never repeats a value from `value`, so the result is safe to show to the model.
 * It returns `[]` when it finds nothing concrete to say.
 */
export function workspaceCommandProblems(value, options = {}) {
  if (!isObject(value)) return [{ path: 'arguments', problem: 'must be a JSON object' }];
  const problems = [];
  if (typeof value.commandId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.commandId)) {
    addWorkspaceProblem(problems, 'commandId', `${requiredText(value.commandId)}must be 1-128 letters, digits, _ or -`);
  }
  if (value.target !== undefined && !workspaceCommandTargets.includes(value.target)) {
    addWorkspaceProblem(problems, 'target', `must be one of ${listText(workspaceCommandTargets)}`);
  }
  const operation = typeof value.operation === 'string' && Object.hasOwn(workspaceOperationShapes, value.operation)
    ? value.operation : undefined;
  if (operation === undefined) {
    addWorkspaceProblem(problems, 'operation',
      `${requiredText(value.operation)}must be one of ${listText(Object.keys(workspaceOperationShapes))}`);
    return problems;
  }
  const shape = workspaceOperationShapes[operation];
  const allowed = operation === 'context-panel' && value.action !== 'open' ? ['action'] : shape.keys;
  const extra = Object.keys(value).filter((key) => !['commandId', 'operation', 'target', ...allowed].includes(key));
  const knownExtra = extra.filter((key) => Object.hasOwn(workspaceCommandSchema.properties, key));
  if (knownExtra.length > 0) {
    let notAllowed = `not allowed with operation ${operation}, which takes ${allowed.length > 0 ? `${listText(allowed, 'and')} only` : 'no other properties'}`;
    if (operation === 'create' || operation === 'update') {
      notAllowed += ' (position a view with a separate place, arrange, move or resize command)';
    } else if (operation === 'context-panel' && value.action !== 'open') {
      notAllowed += ' (view is only allowed when action is open)';
    }
    addWorkspaceProblem(problems, knownExtra.join(', '), notAllowed);
  }
  if (extra.length > knownExtra.length) addWorkspaceProblem(problems, 'arguments', 'has an unexpected property');
  for (const key of shape.required) {
    if (value[key] !== undefined) continue;
    const hint = key === 'view' ? `a JSON object like ${generatedViewExample}` : workspaceFieldProblem(value, key);
    addWorkspaceProblem(problems, key, `is required${hint === undefined ? '' : `, and ${key === 'view' ? 'must be ' : ''}${hint}`}`);
  }
  for (const key of shape.keys) {
    if (key !== 'view' && allowed.includes(key) && value[key] !== undefined) {
      addWorkspaceProblem(problems, key, workspaceFieldProblem(value, key));
    }
  }
  if (allowed.includes('view') && value.view !== undefined) generatedViewProblems(value.view, options, problems);
  return problems;
}

const activityIdPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const toolNamePattern = /^[A-Za-z0-9_-]{1,64}$/;
const activityStateTypes = new Set([
  'listening', 'thinking', 'speaking', 'interrupted', 'reconnecting', 'failed', 'ended',
]);
export const jarvisWorkActivityKinds = Object.freeze([
  'vault_search', 'repo_read', 'repo_search', 'web_search', 'task', 'other',
]);
export const jarvisWorkActivityDetailSchema = Object.freeze(object({
  activityId: { type: 'string', pattern: '^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' },
  kind: { type: 'string', enum: [...jarvisWorkActivityKinds] },
  text: { ...string(80, 1), pattern: '^[^\\u0000-\\u001f\\u007f]*$(?![\\s\\S])' },
  target: object({ label: { ...string(200, 1), pattern: '\\S' } }),
}, ['activityId', 'kind', 'text']));

export function isJarvisWorkActivityDetail(value) {
  return isObject(value) && Object.keys(value).every((key) =>
    ['activityId', 'kind', 'text', 'target'].includes(key)) &&
    typeof value.activityId === 'string' && activityIdPattern.test(value.activityId) &&
    jarvisWorkActivityKinds.includes(value.kind) && boundedString(value.text, 80, 1) &&
    !Array.from(value.text).some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f) &&
    (value.target === undefined || (isObject(value.target) && Object.keys(value.target).length === 1 &&
      boundedString(value.target.label, 200, 1) && /\S/u.test(value.target.label)));
}

export function isJarvisActivityEvent(value) {
  if (isObject(value) && ['work-started', 'work-finished'].includes(value.type)) {
    if (value.source !== undefined && !['chat', 'voice'].includes(value.source)) return false;
    if (value.type === 'work-finished') {
      return Object.keys(value).every((key) => ['type', 'activityId', 'source'].includes(key)) &&
        typeof value.activityId === 'string' && activityIdPattern.test(value.activityId);
    }
    return Object.keys(value).every((key) =>
      ['type', 'source', 'activityId', 'kind', 'text', 'target'].includes(key)) &&
      isJarvisWorkActivityDetail({
        activityId: value.activityId, kind: value.kind, text: value.text,
        ...(value.target === undefined ? {} : { target: value.target }),
      });
  }
  if (!isObject(value) || !activityIdPattern.test(value.activityId) ||
    !['chat', 'voice'].includes(value.source) || typeof value.type !== 'string') return false;
  if (activityStateTypes.has(value.type)) {
    return Object.keys(value).every((key) => ['type', 'activityId', 'source'].includes(key));
  }
  if (!['tool-call-started', 'tool-call-finished'].includes(value.type) ||
    !boundedString(value.toolName, 64, 1) || !toolNamePattern.test(value.toolName)) return false;
  return value.type === 'tool-call-started'
    ? Object.keys(value).every((key) => ['type', 'activityId', 'source', 'toolName'].includes(key))
    : Object.keys(value).every((key) =>
      ['type', 'activityId', 'source', 'toolName', 'outcome'].includes(key)) &&
      ['ok', 'refused', 'error'].includes(value.outcome);
}

const wakeTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isJarvisVoiceWakeEvent(value) {
  return isObject(value) && Object.keys(value).length === 2 && value.type === 'voice.wake' &&
    typeof value.at === 'string' && wakeTimestampPattern.test(value.at) &&
    Number.isFinite(Date.parse(value.at)) && new Date(value.at).toISOString() === value.at;
}

export const backgroundJobKinds = Object.freeze(['research', 'image', 'html_app', 'embedding', 'proactive']);
export const backgroundJobStatuses = Object.freeze(['running', 'done', 'failed', 'cancelled']);
const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const viewIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

function boundedText(value, maximum) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function isTimestamp(value) {
  return typeof value === 'string' && wakeTimestampPattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function isBackgroundJob(value) {
  if (!isObject(value)) return false;
  const allowed = ['jobId', 'kind', 'title', 'status', 'step', 'steps', 'detail', 'viewId',
    'resultId', 'resultDelivery', 'startedAt', 'updatedAt'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return false;
  return typeof value.jobId === 'string' && jobIdPattern.test(value.jobId) &&
    backgroundJobKinds.includes(value.kind) && boundedText(value.title, 80) &&
    backgroundJobStatuses.includes(value.status) &&
    Number.isSafeInteger(value.steps) && value.steps >= 1 && value.steps <= 20 &&
    Number.isSafeInteger(value.step) && value.step >= 0 && value.step <= value.steps &&
    (value.detail === undefined || boundedText(value.detail, 120)) &&
    (value.viewId === undefined || (typeof value.viewId === 'string' && viewIdPattern.test(value.viewId))) &&
    (value.resultId === undefined && value.resultDelivery === undefined ||
      (value.kind === 'research' || value.kind === 'html_app' && typeof value.resultId === 'string' &&
        value.resultId.startsWith('html_app:')) && value.status === 'done' &&
      typeof value.resultId === 'string' && workspaceItemIdRegex.test(value.resultId) &&
      value.resultDelivery !== undefined && ['pending', 'unknown', 'failed', 'delivered'].includes(value.resultDelivery)) &&
    isTimestamp(value.startedAt) && isTimestamp(value.updatedAt);
}

export function isBackgroundJobStep(value) {
  return isObject(value) &&
    Object.keys(value).every((key) => ['status', 'step', 'detail', 'viewId', 'updatedAt'].includes(key)) &&
    backgroundJobStatuses.includes(value.status) &&
    Number.isSafeInteger(value.step) && value.step >= 0 && value.step <= 20 &&
    (value.detail === undefined || boundedText(value.detail, 120)) &&
    (value.viewId === undefined || (typeof value.viewId === 'string' && viewIdPattern.test(value.viewId))) &&
    isTimestamp(value.updatedAt);
}

export function isBackgroundJobDetails(value) {
  return isObject(value) &&
    Object.keys(value).every((key) => ['job', 'steps', 'error', 'resultWindow', 'retryable'].includes(key)) &&
    isBackgroundJob(value.job) &&
    Array.isArray(value.steps) && value.steps.length <= 100 &&
    value.steps.every((step) => isBackgroundJobStep(step) && step.step <= value.job.steps) &&
    (value.error === undefined || (value.job.status === 'failed' &&
      value.error === value.job.detail && boundedText(value.error, 120))) &&
    (value.resultWindow === undefined ||
      (value.job.viewId === value.resultWindow && typeof value.resultWindow === 'string' && viewIdPattern.test(value.resultWindow))) &&
    typeof value.retryable === 'boolean' &&
    (!value.retryable || (value.job.kind === 'research' && value.job.status === 'failed'));
}

export function isBackgroundJobEvent(value) {
  return isObject(value) && Object.keys(value).length === 2 && value.type === 'job' && isBackgroundJob(value.job);
}

export const nowSseEventNames = Object.freeze([
  'mode', 'now', 'voice-wake', 'job', 'jarvis-activity', 'workspace-ready', 'workspace-command',
  'workspace-cancel', 'board',
]);
export const factoryBoardColumnIds = Object.freeze([
  'backlog', 'needs_dan', 'ready', 'in_progress', 'in_review', 'done',
]);

const taskEventSources = Object.freeze(['runner', 'backend', 'github', 'dan']);
const taskEventIdPattern = /^[1-9][0-9]{0,18}$/;
const workspaceSessionIdPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

function isTaskEventId(value) {
  return typeof value === 'string' && taskEventIdPattern.test(value) && BigInt(value) <= maxSqlBigInt;
}

function isEmptyObject(value) {
  return isObject(value) && Object.keys(value).length === 0;
}

export function isTaskEventRecord(value) {
  return isObject(value) &&
    Object.keys(value).length === 7 &&
    Object.keys(value).every((key) => ['id', 'type', 'summary', 'payload', 'payloadTruncated', 'source', 'at'].includes(key)) &&
    isTaskEventId(value.id) &&
    boundedText(value.type, 64) &&
    (value.summary === null || typeof value.summary === 'string' && value.summary.length <= 2_000) &&
    typeof value.payloadTruncated === 'boolean' &&
    taskEventSources.includes(value.source) &&
    isTimestamp(value.at);
}

export function isTaskEventMessage(value) {
  return isObject(value) &&
    Object.keys(value).length === 8 &&
    Object.keys(value).every((key) =>
      ['id', 'type', 'summary', 'payload', 'payloadTruncated', 'source', 'at', 'taskId'].includes(key)) &&
    isTaskEventRecord(Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'taskId'),
    )) &&
    isTaskEventId(value.taskId);
}

const boardWorkers = ['Jarvis', 'Copilot', 'Codex', 'Dan'];
const boardTaskStates = ['Ready', 'Running', 'PauseRequested', 'Paused', 'NeedsAttention', 'Done', 'Cancelled'];
const sandboxEndReasons = ['done', 'cancelled', 'crashed', 'idle', 'idle_expired'];
const githubHosts = new Set(['github.com']);

function isBoardCardIssue(value) {
  return isObject(value) &&
    Object.keys(value).length === 10 &&
    Object.keys(value).every((key) =>
      ['number', 'url', 'title', 'taskCode', 'labels', 'worker', 'state', 'updatedAt', 'closedAt', 'blockedBy'].includes(key)) &&
    Number.isSafeInteger(value.number) && value.number > 0 &&
    safeHttpsUrl(value.url, githubHosts) &&
    boundedString(value.title, 500, 1) &&
    (value.taskCode === null || typeof value.taskCode === 'string' && /^P\d{1,2}-\d{2,3}$/.test(value.taskCode)) &&
    Array.isArray(value.labels) && value.labels.length <= 100 &&
    value.labels.every((label) => boundedString(label, 100, 1)) &&
    new Set(value.labels).size === value.labels.length &&
    (value.worker === null || boardWorkers.includes(value.worker)) &&
    ['open', 'closed'].includes(value.state) &&
    validIsoDateTime(value.updatedAt) &&
    (value.closedAt === null || validIsoDateTime(value.closedAt)) &&
    Array.isArray(value.blockedBy) && value.blockedBy.length <= 100 &&
    value.blockedBy.every((number) => Number.isSafeInteger(number) && number > 0) &&
    new Set(value.blockedBy).size === value.blockedBy.length;
}

function isFactoryBoardTask(value) {
  return isObject(value) &&
    Object.keys(value).length === 8 &&
    Object.keys(value).every((key) => [
      'id', 'state', 'activity', 'agent', 'attemptCount', 'branch', 'startedAt', 'latestSessionEndReason',
    ].includes(key)) &&
    isTaskEventId(value.id) &&
    boardTaskStates.includes(value.state) &&
    (value.activity === null || boundedString(value.activity, 2_000)) &&
    ['codex', 'copilot'].includes(value.agent) &&
    Number.isSafeInteger(value.attemptCount) && value.attemptCount >= 0 &&
    (value.branch === null || boundedString(value.branch, 255)) &&
    (value.startedAt === null || validIsoDateTime(value.startedAt)) &&
    (value.latestSessionEndReason === null || sandboxEndReasons.includes(value.latestSessionEndReason));
}

function isBoardCard(value) {
  return isObject(value) &&
    Object.keys(value).length === 3 &&
    Object.keys(value).every((key) => ['issue', 'pr', 'task'].includes(key)) &&
    isBoardCardIssue(value.issue) &&
    (value.pr === null || isObject(value.pr) &&
      Object.keys(value.pr).length === 4 &&
      Object.keys(value.pr).every((key) => ['number', 'url', 'draft', 'checks'].includes(key)) &&
      Number.isSafeInteger(value.pr.number) && value.pr.number > 0 &&
      safeHttpsUrl(value.pr.url, githubHosts) &&
      typeof value.pr.draft === 'boolean' &&
      ['none', 'pending', 'passing', 'failing'].includes(value.pr.checks)) &&
    (value.task === null || isFactoryBoardTask(value.task));
}

export function isFactoryBoard(value) {
  if (!isObject(value) || Object.keys(value).length !== 4 ||
      Object.keys(value).some((key) => !['project', 'fetchedAt', 'stale', 'columns'].includes(key)) ||
      !isObject(value.project) || Object.keys(value.project).length !== 2 ||
      Object.keys(value.project).some((key) => !['id', 'repo'].includes(key)) ||
      !isTaskEventId(value.project.id) ||
      !boundedString(value.project.repo, 140, 3) ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.project.repo) ||
      !validIsoDateTime(value.fetchedAt) ||
      typeof value.stale !== 'boolean' ||
      !Array.isArray(value.columns) || value.columns.length !== factoryBoardColumnIds.length) return false;
  let cardCount = 0;
  return value.columns.every((column, index) => {
    if (!isObject(column) || Object.keys(column).length !== 2 ||
        Object.keys(column).some((key) => !['id', 'cards'].includes(key)) ||
        column.id !== factoryBoardColumnIds[index] ||
        !Array.isArray(column.cards) || column.cards.length > 2_000) return false;
    cardCount += column.cards.length;
    return cardCount <= 2_000 && column.cards.every(isBoardCard);
  });
}

export function isFactoryBoardUpdate(value) {
  return isObject(value) &&
    Object.keys(value).length === 2 &&
    Object.keys(value).every((key) => ['projectId', 'version'].includes(key)) &&
    isTaskEventId(value.projectId) &&
    Number.isSafeInteger(value.version) && value.version > 0;
}

export function isNowSseEvent(value, options = {}) {
  if (!isObject(value) || Object.keys(value).length !== 2 ||
    !Object.keys(value).every((key) => ['event', 'data'].includes(key)) ||
    !nowSseEventNames.includes(value.event)) return false;
  switch (value.event) {
    case 'mode':
    case 'now':
      return isEmptyObject(value.data);
    case 'board':
      return isFactoryBoardUpdate(value.data);
    case 'voice-wake':
      return isJarvisVoiceWakeEvent(value.data);
    case 'job':
      return isBackgroundJob(value.data);
    case 'jarvis-activity':
      return isJarvisActivityEvent(value.data);
    case 'workspace-ready':
      return isObject(value.data) &&
        Object.keys(value.data).every((key) => ['sessionId', 'trustedBlobHost'].includes(key)) &&
        Object.keys(value.data).includes('sessionId') &&
        typeof value.data.sessionId === 'string' && workspaceSessionIdPattern.test(value.data.sessionId) &&
        (value.data.trustedBlobHost === undefined ||
          boundedText(value.data.trustedBlobHost, 253));
    case 'workspace-command':
      return isObject(value.data) && Object.keys(value.data).length === 2 &&
        Object.keys(value.data).every((key) => ['command', 'expiresAt'].includes(key)) &&
        isWorkspaceCommand(value.data.command, options) &&
        Number.isSafeInteger(value.data.expiresAt) && value.data.expiresAt > 0;
    case 'workspace-cancel':
      return isObject(value.data) && Object.keys(value.data).length === 1 &&
        typeof value.data.commandId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.data.commandId);
    default:
      return false;
  }
}

export function isTaskEventStreamEvent(value) {
  if (!isObject(value) || typeof value.event !== 'string') return false;
  if (value.event === 'ready') {
    return Object.keys(value).length === 2 &&
      Object.keys(value).every((key) => ['event', 'data'].includes(key)) &&
      isEmptyObject(value.data);
  }
  return value.event === 'task' &&
    Object.keys(value).length === 3 &&
    Object.keys(value).every((key) => ['event', 'id', 'data'].includes(key)) &&
    isTaskEventMessage(value.data) && value.id === value.data.id;
}
export const issueAttachmentFields = Object.freeze({
  attachmentIds: {
    type: 'array', maxItems: 5, uniqueItems: true,
    items: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' },
  },
  publish: { type: 'string', enum: ['description', 'public'], default: 'description' },
});
