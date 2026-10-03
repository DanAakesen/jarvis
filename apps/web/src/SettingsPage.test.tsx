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
  },
  codex: { model: 'default', reasoning: 'default' },
  copilot: { model: 'default' },
  global: { maxParallelTasks: 1 },
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
};

const getAccessToken = vi.fn(async () => ['access', 'token', 'fixture'].join('.'));
const fetchMock = vi.fn<typeof fetch>();
const backendUrl = 'https://api.example.com';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function settingsResponse(current = settings) {
  return { settings: current, options };
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
    expect(screen.getByRole('button', {
      name: 'Sleep switch unavailable',
      description: /available in P1-12/,
    })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', {
      name: 'Trigger Codex renewal',
      description: /Secret values are never shown/,
    })).toHaveProperty('disabled', true);
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
