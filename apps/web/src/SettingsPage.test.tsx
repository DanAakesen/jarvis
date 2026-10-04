import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

const settings = {
  jarvis: { model: 'gpt-5.6-luna', reasoning: 'none' },
  voice: {
    speechToTextModel: 'mai-transcribe',
    englishModel: 'gpt-realtime-2.1',
    englishVoice: 'en-GB-Ryan:DragonHDLatestNeural',
    danishVoice: 'da-DK-Harper:MAI-Voice-2',
    defaultLanguage: 'da' as 'da' | 'en',
    minimizeWindowsOnVoiceStart: false,
  },
  codex: { model: 'default', reasoning: 'default' },
  copilot: { model: 'default' },
  global: { maxParallelTasks: 1 },
  newProjects: {
    owner: 'DanAakesen',
    visibility: 'private' as 'private' | 'public',
    templatesRepository: 'DanAakesen/templates',
    defaultAgent: 'copilot' as 'codex' | 'copilot',
    policy: 'deliver_pr' as 'deliver_pr' | 'complete_without_deployment',
    maxParallelTasks: 1,
    defaultBranch: 'main',
  },
};

const options = {
  jarvisModels: ['gpt-5.6-luna'],
  reasoningEfforts: ['none', 'low', 'medium', 'high'],
  speechToTextModels: ['mai-transcribe'],
  englishModels: ['gpt-realtime-2.1'],
  englishVoices: ['en-GB-Ryan:DragonHDLatestNeural'],
  danishVoices: ['da-DK-Harper:MAI-Voice-2'],
  languages: ['da', 'en'],
  codexModels: ['default'],
  codexReasoningEfforts: ['default'],
  copilotModels: ['default'],
  projectVisibilities: ['private', 'public'],
  projectAgents: ['codex', 'copilot'],
  projectPolicies: ['deliver_pr', 'complete_without_deployment'],
};

const getAccessToken = vi.fn(async () => ['access', 'token', 'fixture'].join('.'));
const fetchMock = vi.fn<typeof fetch>();
const backendUrl = 'https://api.example.com';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function settingsResponse(current = settings, credentials: {
  name: 'codex-login' | 'copilot-token';
  expiresAt: string | null;
  lastRenewedAt: string | null;
  status: 'ok' | 'renew_soon' | 'failed' | 'unknown';
}[] = []) {
  return { settings: current, options, credentials };
}

function renderSettingsPage(url: string | null = backendUrl) {
  return render(<SettingsPage backendUrl={url} getAccessToken={getAccessToken} />);
}

beforeEach(() => {
  getAccessToken.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('SettingsPage', () => {
  it('loads, saves changed settings, and explains which work is deferred', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(response(settingsResponse()))
      .mockResolvedValueOnce(response(settingsResponse({
        ...settings,
        jarvis: { ...settings.jarvis, reasoning: 'high' },
        voice: { ...settings.voice, defaultLanguage: 'en' },
        global: { maxParallelTasks: 3 },
      })));
    renderSettingsPage();

    await screen.findByRole('heading', { name: 'Jarvis', level: 2 });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Reasoning effort' }), 'high');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default language' }), 'en');
    await user.clear(screen.getByRole('spinbutton', { name: 'Maximum parallel tasks' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Maximum parallel tasks' }), '3');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText(/Saved\. These are defaults for new sessions and tasks/)).not.toBeNull();
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, request] = fetchMock.mock.calls[1]!;
    expect(request).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(String(request?.body))).toEqual({
      settings: {
        jarvis: { reasoning: 'high' },
        voice: { defaultLanguage: 'en' },
        global: { maxParallelTasks: 3 },
      },
    });
    expect(screen.getByRole('button', {
      name: 'Play English sample',
      description: /voice playback is connected/,
    })).toHaveProperty('disabled', true);
    expect(screen.getByRole('link', {
      name: 'Open the Jarvis main page',
      description: /Manage backend sleep from the Jarvis main page/,
    }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('button', {
      name: 'Trigger Codex renewal',
      description: /Manual renewal and re-seed instructions are unavailable/,
    })).toHaveProperty('disabled', true);
  });

  it('shows credential dates and status without exposing values', async () => {
    fetchMock.mockResolvedValueOnce(response(settingsResponse(settings, [{
      name: 'codex-login',
      expiresAt: '2026-10-05T12:00:00.000Z',
      lastRenewedAt: '2026-09-25T12:00:00.000Z',
      status: 'renew_soon',
    }, {
      name: 'copilot-token',
      expiresAt: null,
      lastRenewedAt: null,
      status: 'unknown',
    }])));
    renderSettingsPage();

    expect(await screen.findByText('Status: Renew soon')).not.toBeNull();
    expect(screen.getByText(/Expires: Oct 5, 2026/)).not.toBeNull();
    expect(screen.getByText(/Last renewed: Sep 25, 2026/)).not.toBeNull();
    expect(screen.getByText('Copilot token (jarvis-copilot)')).not.toBeNull();
    expect(screen.getByText('Expires: Not recorded')).not.toBeNull();
    expect(document.body.textContent).not.toContain('SECRET');
  });

  it('saves New projects defaults', async () => {
    const user = userEvent.setup();
    const updated = {
      ...settings,
      newProjects: {
        owner: 'jarvis-org',
        visibility: 'public' as const,
        templatesRepository: 'jarvis-org/templates',
        defaultAgent: 'codex' as const,
        policy: 'complete_without_deployment' as const,
        maxParallelTasks: 2,
        defaultBranch: 'develop',
      },
    };
    fetchMock.mockResolvedValueOnce(response(settingsResponse())).mockResolvedValueOnce(response(settingsResponse(updated)));
    renderSettingsPage();

    await user.clear(await screen.findByRole('textbox', { name: 'Owner' }));
    await user.type(screen.getByRole('textbox', { name: 'Owner' }), 'jarvis-org');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Visibility' }), 'public');
    await user.clear(screen.getByRole('textbox', { name: 'Templates repository (owner/name)' }));
    await user.type(screen.getByRole('textbox', { name: 'Templates repository (owner/name)' }), 'jarvis-org/templates');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default agent' }), 'codex');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Policy' }), 'complete_without_deployment');
    await user.clear(screen.getByRole('spinbutton', { name: 'New project maximum parallel tasks' }));
    await user.type(screen.getByRole('spinbutton', { name: 'New project maximum parallel tasks' }), '2');
    await user.clear(screen.getByRole('textbox', { name: 'Default branch' }));
    await user.type(screen.getByRole('textbox', { name: 'Default branch' }), 'develop');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText(/Saved\. These are defaults for new sessions and tasks/)).not.toBeNull();
    const [, request] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(String(request?.body))).toEqual({ settings: { newProjects: updated.newProjects } });
  });

  it('defaults voice window minimisation off and persists a changed preference', async () => {
    const user = userEvent.setup();
    const updated = {
      ...settings,
      voice: { ...settings.voice, minimizeWindowsOnVoiceStart: true },
    };
    fetchMock.mockResolvedValueOnce(response(settingsResponse()))
      .mockResolvedValueOnce(response(settingsResponse(updated)));
    renderSettingsPage();

    const toggle = await screen.findByRole('checkbox', { name: 'Minimise all windows when starting voice' });
    expect(toggle).toHaveProperty('checked', false);
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText(/Saved\. These are defaults for new sessions and tasks/)).not.toBeNull();
    expect(await screen.findByRole('checkbox', { name: 'Minimise all windows when starting voice' }))
      .toHaveProperty('checked', true);
    const [, request] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(String(request?.body))).toEqual({
      settings: { voice: { minimizeWindowsOnVoiceStart: true } },
    });
  });

  it('offers retry when settings cannot be loaded', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(settingsResponse()));
    renderSettingsPage();

    expect(await screen.findByRole('alert')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('combobox', { name: 'Reasoning effort' })).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps edits and offers a save retry after a server error', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(response(settingsResponse()))
      .mockResolvedValueOnce(response({ error: 'Internal server error' }, 500))
      .mockResolvedValueOnce(response(settingsResponse({
        ...settings, jarvis: { ...settings.jarvis, reasoning: 'high' },
      })));
    renderSettingsPage();

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Reasoning effort' }), 'high');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not save settings \(HTTP 500\)/);
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' })).toHaveProperty('value', 'high');
    expect(screen.getByRole('button', { name: 'Save settings' })).toHaveProperty('disabled', false);

    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText(/Saved\. These are defaults for new sessions and tasks/)).not.toBeNull();
  });

  it('settles into a visible unavailable state without a backend URL', async () => {
    renderSettingsPage(null);

    expect((await screen.findByRole('alert')).textContent).toMatch(/backend is deployed/);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
