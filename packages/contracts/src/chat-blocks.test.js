import assert from 'node:assert/strict';
import test from 'node:test';
import { chatBlockInputSchema, chatBlockLimits, isChatBlock, isWorkspaceCommand, isWorkspaceSnapshot } from './index.js';

const source = { label: 'Open-Meteo', issuedAt: '2026-11-16T16:02:00.000Z' };
const id = '5d0b2f9e-3c1a-4d57-8a5b-0f7f0b6a9c11';
const forecast = {
  version: 1, id, type: 'forecast', title: 'Copenhagen · Fri 20 Nov', source,
  summary: 'Friday 20 November in Copenhagen: mostly cloudy, high 9 °C, low 5 °C.',
  data: { place: 'Copenhagen', date: '2026-11-20', conditions: 'Mostly cloudy', symbol: 'cloudy', highC: 9, lowC: 5 },
};
const chart = {
  version: 1, id, type: 'chart', title: 'Friday by hour', source,
  summary: 'Temperature peaks at 9 °C at 14:00; rain chance is highest, 40 %, at 20:00.',
  data: {
    xLabel: 'Time of day',
    panels: [
      { title: 'Temperature', unit: '°C', kind: 'line', series: [{ name: 'Temperature', points: [{ x: '08:00', y: 6 }, { x: '14:00', y: 9 }] }] },
      { title: 'Rain probability', unit: '%', kind: 'bar', series: [{ name: 'Rain probability', points: [{ x: '08:00', y: 20 }, { x: '14:00', y: null }] }] },
    ],
  },
};
const list = {
  version: 1, id, type: 'view', title: 'Packing list', source: { label: 'Jarvis', issuedAt: source.issuedAt }, summary: 'Three items to pack.',
  data: { view: { version: 1, title: 'Packing list', renderer: 'list', source: { id: 'now', status: 'complete' }, data: { items: [{ title: 'Passport' }] } } },
};
const withoutStamp = (block) => {
  const copy = structuredClone(block);
  delete copy.id;
  return copy;
};

test('accepts stored blocks of every type', () => {
  assert.equal(isChatBlock(forecast), true);
  assert.equal(isChatBlock(chart), true);
  assert.equal(isChatBlock(list), true);
  assert.equal(isChatBlock({ ...list, source: { label: 'Jarvis' } }), false, 'a stored block needs an issue time');
});

test('accepts a submitted block without id or issue time', () => {
  const submitted = withoutStamp(list);
  submitted.source = { label: 'Jarvis' };
  assert.equal(isChatBlock(submitted, { stored: false }), true);
  assert.equal(isChatBlock(list, { stored: false }), false, 'a submitted block must not choose its id');
});

test('keeps units apart and rejects unusable chart shapes', () => {
  const noPanels = { ...chart, data: { ...chart.data, panels: [] } };
  const noUnit = structuredClone(chart);
  delete noUnit.data.panels[0].unit;
  const tooMany = structuredClone(chart);
  tooMany.data.panels[0].series[0].points = Array.from({ length: chatBlockLimits.pointsPerSeries + 1 }, (_, x) => ({ x, y: 1 }));
  const noAlternative = { ...chart, summary: '' };
  for (const bad of [noPanels, noUnit, tooMany, noAlternative]) assert.equal(isChatBlock(bad), false);
});

test('rejects invalid forecast values', () => {
  for (const data of [
    { ...forecast.data, date: '2026-02-30' },
    { ...forecast.data, lowC: 12 },
    { ...forecast.data, rainChancePercent: 140 },
    { ...forecast.data, symbol: 'sparkles' },
  ]) assert.equal(isChatBlock({ ...forecast, data }), false);
  const partial = { ...forecast.data };
  delete partial.highC;
  delete partial.lowC;
  assert.equal(isChatBlock({ ...forecast, data: partial }), true, 'missing values stay missing');
});

test('view blocks carry only inline renderers and passive actions', () => {
  const html = structuredClone(list);
  html.data.view = { ...html.data.view, renderer: 'html-app', data: { artifactId: '5d0b2f9e-3c1a-4d57-8a5b-0f7f0b6a9c11' } };
  const toolAction = structuredClone(list);
  toolAction.data.view.actions = [{ type: 'call-tool', tool: 'anything' }];
  const link = structuredClone(list);
  link.data.view.actions = [{ type: 'open-route', route: '/usage' }];
  assert.equal(isChatBlock(html), false);
  assert.equal(isChatBlock(toolAction, { registeredTools: ['anything'] }), false);
  assert.equal(isChatBlock(link), true);
});

test('rejects unknown properties, versions and types', () => {
  assert.equal(isChatBlock({ ...forecast, script: 'alert(1)' }), false);
  assert.equal(isChatBlock({ ...forecast, version: 2 }), false);
  assert.equal(isChatBlock({ ...forecast, type: 'html' }), false);
  assert.equal(isChatBlock({ ...forecast, source: { ...source, url: 'http://example.test/' } }), false);
});

test('publishes a schema with the three block types', () => {
  assert.equal(chatBlockInputSchema.oneOf.length, 3);
});

test('Apple Maps history stores the original lookup; a route or result cannot enter the card', () => {
  const lookupId = list.id;
  const request = { query: 'pharmacy nearby', mode: 'walking', bufferMinutes: 10 };
  const view = { version: 1, title: 'Apple Maps', renderer: 'map', source: { id: 'now', status: 'complete' },
    data: { lookupId, request } };
  const block = { ...list, data: { view } };
  assert.equal(isChatBlock(block), true);
  for (const extra of [{ places: [] }, { latitude: 55 }, { travelSeconds: 60 }]) {
    assert.equal(isChatBlock({ ...block, data: { view: { ...view, data: { ...view.data, ...extra } } } }), false);
  }
  const command = { commandId: lookupId, operation: 'apple-maps', target: 'phone', ...request };
  const choice = { commandId: lookupId, operation: 'apple-maps', target: 'phone', lookupId, ordinal: 2 };
  assert.equal(isWorkspaceCommand(choice), true);
  for (const invalid of [{ ordinal: 0 }, { ordinal: 4 }, { ordinal: 1.5 }, { lookupId: 'yesterday' }, { query: 'new search' }]) {
    assert.equal(isWorkspaceCommand({ ...choice, ...invalid }), false);
  }
  assert.equal(isChatBlock({ ...block, data: { view: { ...view, data: { lookupId } } } }), true);
  assert.equal(isWorkspaceCommand({ ...command, speakResult: true }), true);
  assert.equal(isWorkspaceCommand({ ...command, target: 'all' }), false);
  assert.equal(isWorkspaceCommand({ ...command, bufferMinutes: -1 }), false);
  assert.equal(isWorkspaceSnapshot({ windows: [], contextPanelOpen: false, device: { kind: 'phone', appleMaps: true } }), true);
});
