import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProactiveSettings } from './ProactiveSettings';

vi.mock('./activity-context', () => ({
  useJarvisActivity: () => ({ latestActivity: null }),
}));

afterEach(() => vi.unstubAllGlobals());

it('keeps existing Proactive settings usable when Background PI is unavailable', async () => {
  const sources = [
    'todos', 'calendar', 'mail', 'weather', 'factory', 'news', 'travel', 'x',
    'health', 'nutrition', 'notes', 'memory', 'location',
  ];
  const categories = ['deadline', 'clash', 'travel', 'todo', 'prep', 'news', 'weather', 'status', 'suggestion'];
  const settings = {
    paused: false,
    monthlyBudgetDkk: 100,
    backgroundTurnsPerDay: 12,
    sources: sources.map((id) => ({ id, enabled: true })),
    categories: categories.map((id) => ({ id, enabled: true })),
    suggestionScope: 'all',
    newsFeeds: [],
    guidance: '',
    revision: 'a'.repeat(64),
    preferences: [],
    capabilities: { title: 'Examples', examples: [] },
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/proactive/settings')) {
      return new Response(JSON.stringify(settings), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/pi/brain')) {
      return new Response(JSON.stringify({ error: 'not configured' }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected request ${url}`);
  }));
  const view = render(
    <ProactiveSettings backendUrl="https://api.example.test" getAccessToken={async () => 'fixture'} />,
  );
  expect(await screen.findByText('Background PI is unavailable on this backend. Existing Proactive preferences remain editable.'))
    .not.toBeNull();
  expect(screen.getByText('Automatic proactive suggestions')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Save turn allowance' })).not.toBeNull();
  view.unmount();
});
