export const generatedViewVersion = 1;
export const generatedViewRenderers = Object.freeze([
  'table', 'list', 'detail', 'text', 'timeline', 'chart', 'task-card', 'status', 'image',
]);
export const generatedViewActionTypes = Object.freeze(['open-route', 'open-link', 'call-tool', 'window']);

const maxBytes = 256 * 1024;
const rowLimit = 500;
const dateTime = { type: 'string', format: 'date-time' };
const string = (maxLength, minLength = 0) => ({ type: 'string', maxLength, ...(minLength ? { minLength } : {}) });
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const array = (items, maxItems, minItems = 0) => ({
  type: 'array', items, maxItems, ...(minItems ? { minItems } : {}),
});
const routeActionSchema = object({
  type: { const: 'open-route' },
  route: {
    ...string(200, 1),
    pattern: '^/(?:$|factory/(?:tasks|projects|releases)/[1-9][0-9]{0,15}|usage|settings)(?:\\?[^#]*)?$',
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
  id: { type: 'string', enum: ['now', 'factory.tasks', 'factory.projects', 'usage'] },
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
  timeline: object({
    events: array(object({ at: dateTime, title: string(200, 1), description: string(2_000) }, ['at', 'title']), rowLimit),
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

const routePattern = /^\/(?:$|factory\/(?:tasks|projects|releases)\/[1-9]\d{0,15}|usage|settings)(?:\?[^#]*)?$/;
const linkHosts = new Set(['github.com', 'learn.microsoft.com']);
const imageHosts = new Set(['github.com', 'raw.githubusercontent.com', 'avatars.githubusercontent.com']);

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value, max, min = 0) {
  return typeof value === 'string' && value.length >= min && value.length <= max;
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
    case 'open-route':
      return Object.keys(value).every((key) => ['type', 'route'].includes(key)) &&
        boundedString(value.route, 200, 1) && routePattern.test(value.route) && !value.route.includes('\\');
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

function validSource(source) {
  if (!isObject(source) || !['now', 'factory.tasks', 'factory.projects', 'usage'].includes(source.id) ||
    !['complete', 'partial', 'unavailable'].includes(source.status) ||
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
          Object.keys(event).every((key) => ['at', 'title', 'description'].includes(key)) &&
          typeof event.at === 'string' && !Number.isNaN(Date.parse(event.at)) &&
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
    default:
      return false;
  }
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
