// Conversational blocks: typed, data-only content that lives inside an assistant message.
// A block is never code. The model picks one of the types below and fills in data; clients render it natively.

export const chatBlockVersion = 1;
export const chatBlockTypes = Object.freeze(['forecast', 'chart', 'view', 'voice-window']);
export const chatBlockForecastSymbols = Object.freeze([
  'clear', 'partly-cloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'thunder', 'wind',
]);
export const chatBlockChartKinds = Object.freeze(['line', 'bar', 'area']);
/** Generated-view renderers a `view` block may carry; each has a native inline renderer on iPhone. */
export const chatBlockViewRenderers = Object.freeze([
  'text', 'list', 'table', 'detail', 'timeline', 'task-card', 'status', 'image', 'map',
]);
export const chatBlockLimits = Object.freeze({
  blocksPerMessage: 8,
  bytes: 64 * 1024,
  panels: 4,
  seriesPerPanel: 3,
  pointsPerSeries: 200,
});

const chatBlockKeys = ['version', 'id', 'type', 'title', 'source', 'summary', 'data'];
const sourceKeys = ['label', 'url', 'issuedAt', 'status', 'reason'];
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const offsetDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value, max, min = 1) =>
  typeof value === 'string' && value.length >= min && value.length <= max && (min === 0 || /\S/u.test(value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const onlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validIssueTime(value) {
  return typeof value === 'string' && offsetDateTime.test(value) && Number.isFinite(Date.parse(value));
}

function validHttpsUrl(value) {
  if (!text(value, 2_000)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validSource(source, stored) {
  if (!isObject(source) || !onlyKeys(source, sourceKeys) || !text(source.label, 120)) return false;
  if (source.url !== undefined && !validHttpsUrl(source.url)) return false;
  if (stored ? !validIssueTime(source.issuedAt) : source.issuedAt !== undefined && !validIssueTime(source.issuedAt)) return false;
  if (source.status !== undefined && !['complete', 'partial'].includes(source.status)) return false;
  return source.reason === undefined || text(source.reason, 500);
}

function validForecast(data) {
  if (!isObject(data) || !onlyKeys(data, ['place', 'date', 'conditions', 'symbol', 'highC', 'lowC', 'rainChancePercent']) ||
      !text(data.place, 100) || !validDate(data.date) || !text(data.conditions, 80) ||
      !chatBlockForecastSymbols.includes(data.symbol)) return false;
  for (const key of ['highC', 'lowC']) {
    if (data[key] !== undefined && (!finite(data[key]) || data[key] < -100 || data[key] > 70)) return false;
  }
  if (data.highC !== undefined && data.lowC !== undefined && data.lowC > data.highC) return false;
  return data.rainChancePercent === undefined ||
    (finite(data.rainChancePercent) && data.rainChancePercent >= 0 && data.rainChancePercent <= 100);
}

function validChart(data) {
  if (!isObject(data) || !onlyKeys(data, ['xLabel', 'panels']) || !text(data.xLabel, 80) ||
      !Array.isArray(data.panels) || data.panels.length < 1 || data.panels.length > chatBlockLimits.panels) return false;
  return data.panels.every((panel) => {
    if (!isObject(panel) || !onlyKeys(panel, ['title', 'unit', 'kind', 'series']) || !text(panel.title, 80) ||
        !text(panel.unit, 16) || !chatBlockChartKinds.includes(panel.kind) || !Array.isArray(panel.series) ||
        panel.series.length < 1 || panel.series.length > chatBlockLimits.seriesPerPanel) return false;
    const names = new Set();
    return panel.series.every((series) => {
      if (!isObject(series) || !onlyKeys(series, ['name', 'points']) || !text(series.name, 80) ||
          names.has(series.name) || !Array.isArray(series.points) || series.points.length < 1 ||
          series.points.length > chatBlockLimits.pointsPerSeries) return false;
      names.add(series.name);
      return series.points.every((point) => isObject(point) && onlyKeys(point, ['x', 'y']) &&
        (finite(point.x) || text(point.x, 40)) && (point.y === null || finite(point.y)));
    });
  });
}

function validView(data, isGeneratedView, options) {
  if (!isObject(data) || !onlyKeys(data, ['view']) || !isGeneratedView(data.view, options) ||
      !chatBlockViewRenderers.includes(data.view.renderer)) return false;
  // Inline blocks have no windows or tool calls to act on; only links and routes stay.
  return (data.view.actions ?? []).every((action) => action.type === 'open-route' || action.type === 'open-link');
}

/**
 * Validates a block. A stored block carries a server-assigned id and issue time; a block the model submits
 * carries neither (the issue time is optional, the server stamps it when absent).
 */
export function createChatBlockValidator(isGeneratedView) {
  return function isChatBlock(value, options = {}) {
    const stored = options.stored !== false;
    let serialized;
    try { serialized = JSON.stringify(value); } catch { return false; }
    if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > (stored && value?.type === 'voice-window' ? 260 * 1024 : chatBlockLimits.bytes) ||
        !isObject(value) || !onlyKeys(value, stored && value.type === 'voice-window' ? [...chatBlockKeys, 'artifactVersion'] : chatBlockKeys) || value.version !== chatBlockVersion ||
        (stored ? !idPattern.test(value.id ?? '') : value.id !== undefined) ||
        !chatBlockTypes.includes(value.type) || !text(value.title, 200) || !text(value.summary, 1_000) ||
        !validSource(value.source, stored)) return false;
    switch (value.type) {
      case 'voice-window':
        // Only the server archives windows. Retain their data and artifact references, not live tool controls.
        return stored && isObject(value.data) && onlyKeys(value.data, ['view']) &&
          isGeneratedView(value.data.view, options) && !value.data.view.actions?.length &&
          (value.artifactVersion === undefined || (value.data.view.renderer === 'html-app' &&
            Number.isInteger(value.artifactVersion) && value.artifactVersion >= 1 && value.artifactVersion <= 2147483647));
      case 'forecast': return validForecast(value.data);
      case 'chart': return validChart(value.data);
      case 'view': return validView(value.data, isGeneratedView, options);
      default: return false;
    }
  };
}

const str = (maxLength, minLength = 0) => ({ type: 'string', maxLength, ...(minLength ? { minLength } : {}) });
const obj = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const number = { type: 'number' };

/** JSON schema of the block a model submits (no id; the issue time is optional). */
export function createChatBlockInputSchema(generatedViewSchema) {
  const source = obj({
    label: str(120, 1),
    url: { type: 'string', format: 'uri', maxLength: 2_000, pattern: '^https://' },
    issuedAt: { type: 'string', format: 'date-time' },
    status: { type: 'string', enum: ['complete', 'partial'] },
    reason: str(500),
  }, ['label']);
  const base = (type, data) => obj({
    version: { const: chatBlockVersion },
    type: { const: type },
    title: str(200, 1),
    source,
    summary: str(1_000, 1),
    data,
  }, ['version', 'type', 'title', 'source', 'summary', 'data']);
  const point = obj({
    x: { anyOf: [number, str(40, 1)] },
    y: { anyOf: [number, { type: 'null' }] },
  });
  const panel = obj({
    title: str(80, 1),
    unit: str(16, 1),
    kind: { type: 'string', enum: [...chatBlockChartKinds] },
    series: {
      type: 'array', minItems: 1, maxItems: chatBlockLimits.seriesPerPanel,
      items: obj({
        name: str(80, 1),
        points: { type: 'array', minItems: 1, maxItems: chatBlockLimits.pointsPerSeries, items: point },
      }),
    },
  });
  return Object.freeze({
    type: 'object',
    oneOf: [
      base('forecast', obj({
        place: str(100, 1),
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        conditions: str(80, 1),
        symbol: { type: 'string', enum: [...chatBlockForecastSymbols] },
        highC: { type: 'number', minimum: -100, maximum: 70 },
        lowC: { type: 'number', minimum: -100, maximum: 70 },
        rainChancePercent: { type: 'number', minimum: 0, maximum: 100 },
      }, ['place', 'date', 'conditions', 'symbol'])),
      base('chart', obj({
        xLabel: str(80, 1),
        panels: { type: 'array', minItems: 1, maxItems: chatBlockLimits.panels, items: panel },
      })),
      base('view', obj({ view: generatedViewSchema })),
    ],
  });
}
