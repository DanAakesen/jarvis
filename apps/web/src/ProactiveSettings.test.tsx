import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProactiveSettings } from './ProactiveSettings';

const backendUrl = 'https://api.example.com';
const settings = {
  paused: false,
  monthlyBudgetDkk: 100,
  sources: [
    { id: 'todos', enabled: true }, { id: 'calendar', enabled: true }, { id: 'mail', enabled: false },
    { id: 'weather', enabled: false }, { id: 'factory', enabled: true }, { id: 'news', enabled: true },
    { id: 'travel', enabled: false }, { id: 'x', enabled: false },
  ],
  categories: [
    { id: 'deadline', enabled: true }, { id: 'clash', enabled: true }, { id: 'travel', enabled: true },
    { id: 'todo', enabled: true }, { id: 'prep', enabled: true }, { id: 'news', enabled: true },
    { id: 'weather', enabled: true }, { id: 'status', enabled: true }, { id: 'suggestion', enabled: true },
  ],
  suggestionScope: 'all',
  newsFeeds: ['https://news.example.invalid/feed.xml'],
  guidance: 'Prefer concise summaries.',
  revision: 'a'.repeat(64),
  preferences: ['Automatic proactive suggestions are on.', 'The current scope is all personal and work suggestions.'],
  capabilities: {
    title: { en: 'What can I ask?', da: 'Hvad kan jeg bede om?' },
    examples: [
      { en: 'Pause proactive suggestions.', da: 'Sæt proaktive forslag på pause.' },
      { en: 'Resume proactive suggestions.', da: 'Genoptag proaktive forslag.' },
      { en: 'Show only personal suggestions.', da: 'Vis kun personlige forslag.' },
      { en: 'Stop travel suggestions.', da: 'Hold op med rejseforslag.' },
      { en: 'What proactive preferences apply?', da: 'Hvilke præferencer gælder for proaktive forslag?' },
    ],
  },
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let serverSettings: typeof settings;

function renderSettings() {
  return render(<ProactiveSettings backendUrl={backendUrl} getAccessToken={async () => 'fixture-token'} />);
}

function mountFetch() {
  serverSettings = structuredClone(settings);
  fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (typeof patch.instruction === 'string' && patch.instruction === 'Show only personal suggestions.') {
        serverSettings = {
          ...serverSettings,
          suggestionScope: 'personal',
          preferences: ['Automatic proactive suggestions are on.', 'The current scope is personal suggestions only.'],
          revision: 'b'.repeat(64),
        };
      } else if (typeof patch.paused === 'boolean') {
        serverSettings = {
          ...serverSettings,
          paused: patch.paused,
          preferences: [
            patch.paused ? 'Automatic proactive suggestions are paused.' : 'Automatic proactive suggestions are on.',
            `The current scope is ${serverSettings.suggestionScope === 'personal' ? 'personal suggestions only' : 'all personal and work suggestions'}.`,
          ],
          revision: 'c'.repeat(64),
        };
      }
      return response(serverSettings);
    }
    return response(serverSettings);
  });
  vi.stubGlobal('fetch', fetchMock);
}

async function openSection(user = userEvent.setup()) {
  await user.click(await screen.findByRole('button', { name: 'Proactive' }));
  await screen.findByRole('switch', { name: 'Automatic proactive suggestions' });
  return user;
}

beforeEach(mountFetch);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Proactive settings', () => {
  it('shows one switch, ordinary-language understanding, and capability-backed help', async () => {
    renderSettings();
    await openSection();
    expect(screen.getByRole('switch', { name: 'Automatic proactive suggestions' })).toHaveProperty('checked', true);
    expect(screen.getByText('What Jarvis understands')).not.toBeNull();
    expect(screen.getByText('The current scope is all personal and work suggestions.')).not.toBeNull();
    expect(screen.queryByRole('group', { name: 'Suggestion categories' })).toBeNull();
    expect(screen.queryByLabelText('Monthly budget (DKK)')).toBeNull();
    expect(screen.queryByLabelText('Guidance')).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByText('Hvad kan jeg bede om? / What can I ask?'));
    expect(screen.getByText('Pause proactive suggestions.')).not.toBeNull();
    expect(screen.getByText('Stop travel suggestions.')).not.toBeNull();
  });

  it('saves a plain-language preference with its current revision and keeps hidden settings intact', async () => {
    renderSettings();
    const user = await openSection();
    fireEvent.change(screen.getByLabelText('Change a preference in your own words'), {
      target: { value: 'Show only personal suggestions.' },
    });
    await user.click(screen.getByRole('button', { name: 'Save preference' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, request]) => request?.method === 'PATCH')!;
    expect(url).toBe(`${backendUrl}/proactive/settings`);
    expect(JSON.parse(String(init?.body))).toEqual({
      instruction: 'Show only personal suggestions.',
      expectedRevision: 'a'.repeat(64),
    });
    expect(serverSettings).toMatchObject({
      monthlyBudgetDkk: 100,
      sources: settings.sources,
      categories: settings.categories,
      newsFeeds: settings.newsFeeds,
      guidance: settings.guidance,
    });
    expect(await screen.findByText('The current scope is personal suggestions only.')).not.toBeNull();
    expect(screen.getByText('Saved and confirmed.')).not.toBeNull();
  });

  it('saves pause immediately without changing the hidden advanced settings', async () => {
    renderSettings();
    const user = await openSection();
    await user.click(screen.getByRole('switch', { name: 'Automatic proactive suggestions' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1];
    expect(JSON.parse(String(patch?.body))).toEqual({ paused: true, expectedRevision: 'a'.repeat(64) });
    expect(screen.getByRole('switch', { name: 'Automatic proactive suggestions' })).toHaveProperty('checked', false);
    expect(screen.getByText('Automatic suggestions paused. Requested reminders are unchanged.')).not.toBeNull();
    expect(serverSettings.monthlyBudgetDkk).toBe(settings.monthlyBudgetDkk);
    expect(serverSettings.sources).toEqual(settings.sources);
  });

  it('does not claim a failed or unsupported save succeeded', async () => {
    renderSettings();
    const user = await openSection();
    fireEvent.change(screen.getByLabelText('Change a preference in your own words'), {
      target: { value: 'Give me more suggestions.' },
    });
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PATCH' ? response({ error: 'unsupported_preference' }, 422) : response(serverSettings));
    await user.click(screen.getByRole('button', { name: 'Save preference' }));
    expect(await screen.findByText('Jarvis cannot enforce that preference yet. Choose one of the supported examples below.')).not.toBeNull();
    expect(screen.getByLabelText('Change a preference in your own words')).toHaveProperty('value', 'Give me more suggestions.');

    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PATCH' ? response({ error: 'DO NOT SHOW THIS' }, 500) : response(serverSettings));
    fireEvent.change(screen.getByLabelText('Change a preference in your own words'), {
      target: { value: 'Stop travel suggestions.' },
    });
    await user.click(screen.getByRole('button', { name: 'Save preference' }));
    expect(await screen.findByText('Could not save this preference. Nothing was confirmed.')).not.toBeNull();
    expect(screen.queryByText('DO NOT SHOW THIS')).toBeNull();
  });

  it('refreshes an open view on focus but keeps unsaved edits until explicitly reloaded', async () => {
    renderSettings();
    const user = await openSection();
    serverSettings = {
      ...serverSettings, paused: true, revision: 'd'.repeat(64),
      preferences: ['Automatic proactive suggestions are paused.', 'The current scope is all personal and work suggestions.'],
    };
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Automatic proactive suggestions' })).toHaveProperty('checked', false));

    const field = screen.getByLabelText('Change a preference in your own words');
    fireEvent.change(field, { target: { value: 'Stop travel suggestions.' } });
    serverSettings = {
      ...serverSettings, paused: false, revision: 'e'.repeat(64),
      preferences: ['Automatic proactive suggestions are on.', 'The current scope is all personal and work suggestions.'],
    };
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(field).toHaveProperty('value', 'Stop travel suggestions.');
    await user.click(screen.getByRole('button', { name: 'Reload current preferences' }));
    await waitFor(() => expect(screen.getByLabelText('Change a preference in your own words')).toHaveProperty('value', ''));
    expect(screen.getByRole('switch', { name: 'Automatic proactive suggestions' })).toHaveProperty('checked', true);
  });

  it('shows a non-retryable backend-off state for settings 404', async () => {
    fetchMock.mockResolvedValue(response({}, 404));
    renderSettings();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Proactive' }));
    expect(await screen.findByText('Proactive is not turned on for this backend.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
