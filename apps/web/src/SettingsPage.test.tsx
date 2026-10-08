import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { ThemePreferenceContext, type ThemeMode, type ThemePreference } from './theme-preference-context';

const settings = {
  appearance: { theme: 'light' as ThemeMode },
  jarvis: { model: 'gpt-5.6-luna', reasoning: 'none' },
  personality: {
    tone: 'british_butler' as 'british_butler' | 'warm' | 'direct' | 'playful',
    responseStyle: 'concise' as 'concise' | 'balanced' | 'detailed',
    customInstructions: '',
  },
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
  global: { maxParallelTasks: 1, screenShareDailyFrameCap: 300 },
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
  themes: ['light', 'dark', 'system'],
  jarvisModels: ['gpt-5.6-luna'],
  reasoningEfforts: ['none', 'low', 'medium', 'high'],
  personalityTones: ['british_butler', 'warm', 'direct', 'playful'],
  personalityResponseStyles: ['concise', 'balanced', 'detailed'],
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
const themePreference = {
  theme: 'light' as ThemeMode,
  resolvedTheme: 'light' as const,
  appearance: { theme: 'light' as ThemeMode },
  state: 'ready' as const,
  saving: false,
  error: '',
  message: '',
  saveTheme: vi.fn<ThemePreference['saveTheme']>(async () => {}),
  refreshAppearance: vi.fn<ThemePreference['refreshAppearance']>(async () => {}),
  retry: vi.fn(),
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function settingsResponse(current = settings, credentials: {
  name: string;
  expiresAt: string | null;
  lastRenewedAt: string | null;
  status: 'ok' | 'renew_soon' | 'failed' | 'unknown';
}[] = []) {
  return { settings: current, options, credentials };
}

function renderSettingsPage(url: string | null = backendUrl) {
  return render(
    <ThemePreferenceContext.Provider value={themePreference}>
      <SettingsPage backendUrl={url} getAccessToken={getAccessToken} />
    </ThemePreferenceContext.Provider>,
  );
}

beforeEach(() => {
  getAccessToken.mockClear();
  fetchMock.mockReset();
  localStorage.clear();
  themePreference.saveTheme.mockClear();
  themePreference.refreshAppearance.mockClear();
  themePreference.retry.mockClear();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith('/recipes')
      ? Promise.resolve(response({ recipes: [] }))
      : fetchMock(input, init));
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
        global: { maxParallelTasks: 3, screenShareDailyFrameCap: 240 },
      })));
    renderSettingsPage();

    await screen.findByRole('heading', { name: 'Jarvis', level: 2 });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Reasoning effort' }), 'high');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default language' }), 'en');
    await user.clear(screen.getByRole('spinbutton', { name: 'Maximum parallel tasks' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Maximum parallel tasks' }), '3');
    await user.clear(screen.getByRole('spinbutton', { name: 'Daily screen inspection limit' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Daily screen inspection limit' }), '240');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText(/Saved\. These are defaults for new sessions and tasks/)).not.toBeNull();
    expect(getAccessToken).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, request] = fetchMock.mock.calls[1]!;
    expect(request).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(String(request?.body))).toEqual({
      settings: {
        jarvis: { reasoning: 'high' },
        voice: { defaultLanguage: 'en' },
        global: { maxParallelTasks: 3, screenShareDailyFrameCap: 240 },
      },
    });

    expect(screen.getByRole('button', {
      name: 'Play English sample',
      description: /voice playback is connected/,
    })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('link', { name: 'Open the Jarvis main page' })).toBeNull();
    expect(screen.getByRole('button', {
      name: 'Trigger Codex renewal',
      description: /Manual renewal and re-seed instructions are unavailable/,
    })).toHaveProperty('disabled', true);
  });

  it('loads and saves personality preferences through the existing settings endpoint', async () => {
    const user = userEvent.setup();
    const updated = {
      ...settings,
      personality: {
        tone: 'warm' as const,
        responseStyle: 'balanced' as const,
        customInstructions: 'Use plain language and short paragraphs.',
      },
    };
    fetchMock.mockResolvedValueOnce(response(settingsResponse()))
      .mockResolvedValueOnce(response(settingsResponse(updated)));
    renderSettingsPage();

    expect(await screen.findByRole('heading', { name: 'Jarvis Personality', level: 2 })).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Tone' })).toHaveProperty('value', 'british_butler');
    expect(screen.getByRole('combobox', { name: 'Response style' })).toHaveProperty('value', 'concise');
    expect(screen.getByText(/apply to new sessions/)).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'Custom instructions' })).toHaveProperty('maxLength', 2_000);
    expect(screen.getByRole('button', {
      name: 'Reset personality',
      description: /already matches the default/,
    })).toHaveProperty('disabled', true);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Tone' }), 'warm');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Response style' }), 'balanced');
    await user.type(screen.getByRole('textbox', { name: 'Custom instructions' }), updated.personality.customInstructions);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText(/Saved\. These are defaults for new sessions and tasks/)).not.toBeNull();
    const [, request] = fetchMock.mock.calls[1]!;
    expect(request).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(String(request?.body))).toEqual({ settings: { personality: updated.personality } });
  });

  it('shows pending feedback and prevents duplicate saves', async () => {
    const user = userEvent.setup();
    const updated = { ...settings, personality: { ...settings.personality, tone: 'warm' as const } };
    let resolveSave!: (value: Response) => void;
    const pendingSave = new Promise<Response>((resolve) => { resolveSave = resolve; });
    fetchMock.mockResolvedValueOnce(response(settingsResponse())).mockReturnValueOnce(pendingSave);
    renderSettingsPage();

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Tone' }), 'warm');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('combobox', { name: 'Tone' })).toHaveProperty('disabled', true);
    resolveSave(response(settingsResponse(updated)));
    expect(await screen.findByText(/Saved\. These are defaults for new sessions and tasks/)).not.toBeNull();
  });

  it('resets personality to the current defaults and preserves edits when reset fails', async () => {
    const user = userEvent.setup();
    const customized = {
      ...settings,
      personality: {
        tone: 'playful' as const,
        responseStyle: 'detailed' as const,
        customInstructions: 'Use jokes and detail.',
      },
    };
    fetchMock.mockResolvedValueOnce(response(settingsResponse(customized)))
      .mockResolvedValueOnce(response({ error: 'Internal server error' }, 500))
      .mockResolvedValueOnce(response(settingsResponse()));
    renderSettingsPage();

    await screen.findByRole('heading', { name: 'Jarvis Personality', level: 2 });
    await user.click(screen.getByRole('button', { name: 'Reset personality' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not save settings \(HTTP 500\)/);
    expect(screen.getByRole('combobox', { name: 'Tone' })).toHaveProperty('value', 'playful');
    expect(screen.getByRole('combobox', { name: 'Response style' })).toHaveProperty('value', 'detailed');
    expect(screen.getByRole('textbox', { name: 'Custom instructions' })).toHaveProperty('value', customized.personality.customInstructions);
    expect(screen.getByRole('button', { name: 'Reset personality' })).toHaveProperty('disabled', false);

    await user.click(screen.getByRole('button', { name: 'Reset personality' }));
    expect(screen.getByRole('combobox', { name: 'Tone' })).toHaveProperty('value', settings.personality.tone);
    expect(screen.getByRole('combobox', { name: 'Response style' })).toHaveProperty('value', settings.personality.responseStyle);
    expect(screen.getByRole('textbox', { name: 'Custom instructions' })).toHaveProperty('value', '');
    expect(await screen.findByText(/Personality reset and saved/)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save settings' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/already matches the default/)).not.toBeNull();
    const [, request] = fetchMock.mock.calls[2]!;
    expect(JSON.parse(String(request?.body))).toEqual({ settings: { personality: settings.personality } });
  });

  it('offers light, dark, and system modes and keeps appearance variables Jarvis-directed', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response(settingsResponse()));
    renderSettingsPage();

    await screen.findByRole('heading', { name: 'Appearance', level: 2 });
    expect(screen.getByText(/light, dark, or system appearance/)).not.toBeNull();
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('radio', { name: 'System' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', {
      name: 'Edit theme variables',
      description: /Jarvis can update approved appearance variables/,
    })).toHaveProperty('disabled', true);

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(themePreference.saveTheme).toHaveBeenCalledWith('dark');
    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(themePreference.saveTheme).toHaveBeenCalledWith('system');
  });

  it('shows custom-instruction validation and prevents saving invalid control characters', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response(settingsResponse()));
    renderSettingsPage();

    const instructions = await screen.findByRole('textbox', { name: 'Custom instructions' });
    fireEvent.change(instructions, { target: { value: 'Invalid\u0001instruction' } });

    expect(instructions.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toMatch(/Remove control characters/);
    expect(screen.getByRole('button', { name: 'Save settings' })).toHaveProperty('disabled', true);

    await user.clear(instructions);
    await user.type(instructions, 'Use clear language.');
    expect(instructions.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByText(/Remove control characters/)).toBeNull();
  });

  it('keeps custom-instruction edits after a failed save and allows retry', async () => {
    const user = userEvent.setup();
    const updated = {
      ...settings,
      personality: { ...settings.personality, customInstructions: 'Use clear language.' },
    };
    fetchMock.mockResolvedValueOnce(response(settingsResponse()))
      .mockResolvedValueOnce(response({ error: 'Internal server error' }, 500))
      .mockResolvedValueOnce(response(settingsResponse(updated)));
    renderSettingsPage();

    const instructions = await screen.findByRole('textbox', { name: 'Custom instructions' });
    await user.type(instructions, updated.personality.customInstructions);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not save settings \(HTTP 500\)/);
    expect(instructions).toHaveProperty('value', updated.personality.customInstructions);
    expect(screen.getByRole('button', { name: 'Save settings' })).toHaveProperty('disabled', false);

    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText(/Saved\. These are defaults for new sessions and tasks/)).not.toBeNull();
    const [, request] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(String(request?.body))).toEqual({
      settings: { personality: { customInstructions: updated.personality.customInstructions } },
    });
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
    expect(JSON.parse(localStorage.getItem('jarvis.voice-workspace-preference') ?? '{}')).toEqual({
      voice: { minimizeWindowsOnVoiceStart: true },
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

  it('edits models per role, tuning, research, retrieval and timeouts, and requests a deployment removal', async () => {
    const user = userEvent.setup();
    const role = (model: string) => ({ model, reasoningEffort: 'none' });
    const advanced = {
      ...settings,
      voice: { ...settings.voice, serverVadThreshold: 0.7, prefixPaddingMs: 300, silenceDurationMs: 600, bargeInEnabled: true, maxSpokenReplyTokens: 4096 },
      research: { depth: 'quick', maxSources: 50, timeoutSeconds: 305 },
      timeouts: { toolTimeoutSeconds: 30, longToolTimeoutSeconds: 320, backendHttpTimeoutSeconds: 10 },
      memory: { similarityThreshold: 0.35, searchTopK: 5, graphTextSimilarityThreshold: 0.12, automaticCapture: true },
      roles: { chat: role('gpt-5.6-luna'), vision: role('gpt-6-luna'), research: role('gpt-5.6-luna'), voice: role('gpt-realtime-2.1'),
        transcription: role('mai-transcribe'), embedding: role('text-embedding-3-small'), codex: role('default'), copilot: role('default') },
    };
    const roleOptions = (models: string[], efforts: string[]) => ({ models, reasoningEffortsByModel: Object.fromEntries(models.map((model) => [model, efforts])) });
    const advancedOptions = { ...options, roles: {
      chat: { models: ['gpt-5.6-luna', 'gpt-6-luna'], reasoningEffortsByModel: { 'gpt-5.6-luna': ['none', 'low'], 'gpt-6-luna': ['none', 'minimal', 'xhigh'] } },
      vision: roleOptions(['gpt-6-luna'], ['none']), research: roleOptions(['gpt-5.6-luna'], ['none']), voice: roleOptions(['gpt-realtime-2.1'], ['none']),
      transcription: roleOptions(['mai-transcribe'], ['none']), embedding: roleOptions(['text-embedding-3-small'], ['none']),
      codex: roleOptions(['default'], ['none', 'high']), copilot: roleOptions(['default'], ['none']),
    } };
    const catalogue = { source: 'arm', deployments: [{ name: 'gpt-6-luna', model: 'gpt-6-luna', version: '1', sku: 'GlobalStandard', capacity: 50,
      capabilities: ['chat', 'image'], reasoningEfforts: ['none'] }] };
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/models')) return response(catalogue);
      if (url.endsWith('/models/deployments/gpt-6-luna') && init?.method === 'DELETE') return response({ status: 'approval_pending', name: 'gpt-6-luna' }, 202);
      if (url.endsWith('/settings') && init?.method === 'PATCH') return response({ settings: advanced, options: advancedOptions, credentials: [] });
      return response({ settings: advanced, options: advancedOptions, credentials: [] });
    });
    renderSettingsPage();

    await screen.findByRole('heading', { name: 'Models', level: 2 });
    // The older Jarvis model section gives way to Models when the backend sends roles.
    expect(screen.queryByRole('heading', { name: 'Jarvis', level: 2 })).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Chat model' }), 'gpt-6-luna');
    const chatEffort = screen.getByRole('combobox', { name: 'Chat reasoning' });
    expect([...chatEffort.querySelectorAll('option')].map((option) => option.value)).toEqual(['none', 'minimal', 'xhigh']);
    await user.selectOptions(chatEffort, 'xhigh');
    await user.click(screen.getByRole('switch', { name: /Interrupt Jarvis by speaking/ }));
    await user.click(screen.getByRole('button', { name: 'Deep' }));

    await user.clear(screen.getByRole('spinbutton', { name: 'Tools' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Tools' }), '500');
    expect(screen.getByText('Use 1–120 (whole number).')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save settings' })).toHaveProperty('disabled', true);
    await user.clear(screen.getByRole('spinbutton', { name: 'Tools' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Tools' }), '45');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText(/Saved\. These are defaults/)).not.toBeNull();
    const patch = fetchMock.mock.calls.find(([, request]) => request?.method === 'PATCH')!;
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ settings: {
      roles: { chat: { model: 'gpt-6-luna', reasoningEffort: 'xhigh' } },
      voice: { bargeInEnabled: false },
      research: { depth: 'deep' },
      timeouts: { toolTimeoutSeconds: 45 },
    } });

    expect((await screen.findAllByText('Image')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Remove gpt-6-luna' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/Removal of gpt-6-luna requested\. Approve it in Teams\./)).not.toBeNull();
  });

  it('still loads when the backend reports a credential this page does not know yet', async () => {
    fetchMock.mockResolvedValueOnce(response(settingsResponse(settings, [
      { name: 'codex-login', expiresAt: null, lastRenewedAt: null, status: 'ok' },
      { name: 'github-app', expiresAt: null, lastRenewedAt: '2026-10-08T14:31:54.120Z', status: 'ok' },
      { name: 'future-token', expiresAt: null, lastRenewedAt: null, status: 'unknown' },
    ])));
    renderSettingsPage();
    expect(await screen.findByText('GitHub App')).not.toBeNull();
    expect(screen.getByText('future-token')).not.toBeNull();
  });
});