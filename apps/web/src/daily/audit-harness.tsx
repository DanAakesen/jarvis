import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { dailyCapabilitiesVersion, dailyQuerySources as sources } from '@jarvis/contracts';
import { DailyHome } from './DailyHome';
import { dailyFixture, jsonResponse } from './test-support';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const state = params.get('state') || 'populated';
const available = Object.values(sources);
const brief = { id: 'synthetic-brief-1', started_at: '2026-10-18T08:00:00', trigger: 'scheduled', status: 'completed', delivery_status: 'not_requested', preview_text: 'Synthetic brief preview.', body_json: { sections: [{ title: 'Overview', text: 'Synthetic detail content.' }] } };
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname.endsWith('/daily/capabilities')) return jsonResponse({ module: 'daily', version: dailyCapabilitiesVersion, sources: available });
  if (!url.pathname.endsWith('/daily/query')) return new Response(null, { status: 404 });
  if (state === 'loading') return new Promise(() => {});
  if (state === 'error') return jsonResponse({ error: 'Synthetic fixture error' }, 503);
  const query = JSON.parse(String(init?.body));
  const items = state === 'empty' ? [] : query.source === sources.briefs || query.source === sources.brief ? [brief] : [];
  return jsonResponse(dailyFixture(query, items));
};
createRoot(document.getElementById('root')!).render(<StrictMode><div className="app-shell" data-navigation-open="true"><main className="shell-main"><MemoryRouter initialEntries={[`/daily?section=briefs${location.search.replace(/^\?/u, '&')}`]}><DailyHome backendUrl={location.origin} getAccessToken={async () => 'synthetic-token'} /></MemoryRouter></main></div></StrictMode>);
