export const generatedViewVersion = 1;
export const systemSmokeCheckIds = Object.freeze([
  'google', 'github_app', 'vault', 'foundry.embeddings', 'research', 'pc_bridge',
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
export const folioKinds = Object.freeze(['research', 'html_app', 'image', 'knowledge_graph']);
const folioIdPattern = '^(?:research|html_app|image|knowledge_graph):[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$';
export const folioItemSchema = Object.freeze(object({
  id: { type: 'string', pattern: folioIdPattern },
  title: string(200, 1),
  kind: { enum: folioKinds },
  createdAt: dateTime,
  promptSummary: string(500, 1),
  pinned: { type: 'boolean' },
}));
export const folioSearchSchema = Object.freeze(object({
  q: string(120, 1),
  kind: { enum: folioKinds },
  before: dateTime,
}, []));
export const folioSearchResponseSchema = Object.freeze(object({
  items: array(folioItemSchema, 100),
}));
export const folioPatchSchema = Object.freeze({
  type: 'object',
  properties: {
    title: { ...string(200, 1), pattern: '\\S' },
    pinned: { type: 'boolean' },
  },
  required: [],
  minProperties: 1,
  additionalProperties: false,
});
export const folioDeleteSchema = Object.freeze(object({
  confirm: { const: true },
}));
export const folioSearchToolSchema = Object.freeze(object({
  q: { ...string(120, 1), pattern: '\\S' },
  kind: { enum: folioKinds },
}, []));
export const folioOpenToolSchema = Object.freeze({
  type: 'object',
  properties: {
    id: { type: 'string', pattern: folioIdPattern },
    query: { ...string(120, 1), pattern: '\\S' },
  },
  required: [],
  minProperties: 1,
  maxProperties: 1,
  additionalProperties: false,
});
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
  'home', 'factory', 'settings', 'usage', 'knowledge', 'folio', 'status',
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
  return isWorkspaceLocation(value, ['folioOpen', 'focusedViewId', 'previous']) &&
    (value.folioOpen === undefined || typeof value.folioOpen === 'boolean') &&
    (value.focusedViewId === undefined || typeof value.focusedViewId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.focusedViewId)) &&
    (value.previous === undefined || isWorkspaceLocation(value.previous));
}

export function isWorkspaceSnapshot(value) {
  return isObject(value) &&
    Object.keys(value).every((key) => ['windows', 'contextPanelOpen', 'frame', 'view'].includes(key)) &&
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
    operation: { type: 'string', enum: ['create', 'update', 'show', 'close', 'minimise', 'restore', 'focus', 'move', 'resize', 'layout', 'context-panel', 'navigate', 'conversation', 'place', 'arrange', 'minimise-all', 'restore-all', 'close-all', 'pin', 'unpin'] },
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
    action: { enum: ['open', 'close', 'toggle', 'show', 'hide'] },
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
    Object.keys(entry).every((key) => ['id', 'status', 'checkedAt'].includes(key)) &&
    Object.keys(entry).length === 3 &&
    entry.id === systemSmokeCheckIds[index] &&
    ['ok', 'degraded', 'down', 'unknown'].includes(entry.status) &&
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

export function isFolioItem(value) {
  return isObject(value) && Object.keys(value).length === 6 &&
    /^[a-z_]+:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value.id) &&
    folioKinds.includes(value.kind) && value.id.startsWith(`${value.kind}:`) &&
    boundedString(value.title, 200, 1) && value.title === value.title.trim() &&
    validIsoDateTime(value.createdAt) && boundedString(value.promptSummary, 500, 1) &&
    value.promptSummary === value.promptSummary.trim() && typeof value.pinned === 'boolean';
}

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
  const hasOnly = (...keys) => Object.keys(value).every((key) => ['commandId', 'operation', ...keys].includes(key));
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

export const backgroundJobKinds = Object.freeze(['research', 'image', 'html_app', 'embedding']);
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
  const allowed = ['jobId', 'kind', 'title', 'status', 'step', 'steps', 'detail', 'viewId', 'startedAt', 'updatedAt'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return false;
  return typeof value.jobId === 'string' && jobIdPattern.test(value.jobId) &&
    backgroundJobKinds.includes(value.kind) && boundedText(value.title, 80) &&
    backgroundJobStatuses.includes(value.status) &&
    Number.isSafeInteger(value.steps) && value.steps >= 1 && value.steps <= 20 &&
    Number.isSafeInteger(value.step) && value.step >= 0 && value.step <= value.steps &&
    (value.detail === undefined || boundedText(value.detail, 120)) &&
    (value.viewId === undefined || (typeof value.viewId === 'string' && viewIdPattern.test(value.viewId))) &&
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