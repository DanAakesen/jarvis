import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from './SettingsPage';
import { expectNoDailyInRenderedContent } from './test/visible-copy';
import { ResearchSection } from './SettingsAdvanced';
import { ProjectsPage } from './factory/ProjectsPage';
import { ThemePreferenceContext, type ThemeMode, type ThemePreference } from './theme-preference-context';
import { CollapsibleSection } from './CollapsibleSection';

const settings = {
  identity: { description: '' },
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
    danishVoice: 'da-DK-JeppeNeural',
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
  danishVoices: ['da-DK-JeppeNeural'],
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
  saveAppearance: vi.fn<NonNullable<ThemePreference['saveAppearance']>>(async () => true),
  refreshAppearance: vi.fn<ThemePreference['refreshAppearance']>(async () => {}),
  retry: vi.fn(),
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function settingsResponse(current: typeof settings & { global: typeof settings.global & { maxCheckAttempts?: number; visionDailyBudgetUsd?: number } } = settings, credentials: {
  name: string;
  expiresAt: string | null;
  lastRenewedAt: string | null;
  status: 'ok' | 'renew_soon' | 'failed' | 'unknown';
}[] = [], modelWarnings?: Record<string, string>) {
  return { settings: current, options, credentials, ...(modelWarnings ? { modelWarnings } : {}) };
}

function renderSettingsPage(url: string | null = backendUrl, healthUpload?: ReactNode, deepLinkTargets = false) {
  return render(
    <ThemePreferenceContext.Provider value={themePreference}>
      <SettingsPage backendUrl={url} getAccessToken={getAccessToken}
        healthUpload={healthUpload}
        renderProjects={(projectDefaults) => (
          <CollapsibleSection storageKey="settings.projects" id="projects" headingId="projects-heading" title="Projects">
            {projectDefaults}
          </CollapsibleSection>
        )}
        nutrition={deepLinkTargets
          ? <CollapsibleSection storageKey="settings.nutrition-targets" id="nutrition-targets" title="Nutrition targets">
              <p>Nutrition target fixture</p>
            </CollapsibleSection>
          : undefined}
        trainingTargets={deepLinkTargets
          ? <CollapsibleSection storageKey="settings.training-targets" id="training-targets" title="Training targets">
              <p>Training target fixture</p>
            </CollapsibleSection>
          : undefined}
        proactive={deepLinkTargets
          ? <CollapsibleSection storageKey="settings.proactive" id="proactive-settings" title="Proactive" persist={false} initiallyOpen={false}>
              <p>Proactive fixture</p>
            </CollapsibleSection>
          : undefined} />
    </ThemePreferenceContext.Provider>,
  );
}

beforeEach(() => {
  getAccessToken.mockClear();
  fetchMock.mockReset();
  localStorage.clear();
  themePreference.saveTheme.mockClear();
  themePreference.saveAppearance.mockClear();
  themePreference.refreshAppearance.mockClear();
  themePreference.retry.mockClear();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith('/recipes')
      ? Promise.resolve(response({ recipes: [] }))
      : fetchMock(input, init));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('SettingsPage', () => {
  it.each([
    { hash: 'health-upload', key: 'settings.health-upload' },
    { hash: 'projects', key: 'settings.projects' },
    { hash: 'proactive-settings', key: 'settings.proactive' },
    { hash: 'nutrition-targets', key: 'settings.nutrition-targets' },
    { hash: 'training-targets', key: 'settings.training-targets' },
  ])('opens and scrolls to the #$hash section after Settings is ready', async ({ hash, key }) => {
    window.history.replaceState({}, '', `/settings#${hash}`);
    localStorage.setItem(`jarvis.sections.${key}`, '0');
    document.documentElement.dataset.motion = 'reduced';
    fetchMock.mockResolvedValueOnce(response(settingsResponse()));
    const view = renderSettingsPage(backendUrl,
      hash === 'health-upload' ? <p>Health upload test content</p> : undefined, true);
    const target = view.container.ownerDocument.getElementById(hash) as HTMLElement;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    await screen.findByRole('heading', { name: 'Jarvis', level: 2 });
    await waitFor(() => expect(target.getAttribute('data-open')).toBe('true'));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' }));
    document.documentElement.removeAttribute('data-motion');
  });

  it('puts the single explicit Save in the mobile header and keeps the desktop footer unchanged', async () => {
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({
      matches: query === '(max-width: 700px)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }) });
    fetchMock.mockImplementation(async () => response(settingsResponse()));
    const mobile = renderSettingsPage();
    const save = await screen.findByRole('button', { name: 'Save settings' });
    expect(save.closest('.settings-header')).not.toBeNull();
    expect(save.getAttribute('form')).toBe('settings-form');
    expect(mobile.container.querySelector('.settings-save-desktop')).toBeNull();
    mobile.unmount();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
    const desktop = renderSettingsPage();
    const desktopSave = await screen.findByRole('button', { name: 'Save settings' });
    expect(desktopSave.closest('.settings-header')).toBeNull();
    expect(desktop.container.querySelectorAll('.settings-save')).toHaveLength(1);
  });

  it('ignores unknown Settings hashes without opening or scrolling a section', async () => {
    window.history.replaceState({}, '', '/settings#unknown-section');
    localStorage.setItem('jarvis.sections.settings.projects', '0');
    fetchMock.mockResolvedValueOnce(response(settingsResponse()));
    const view = renderSettingsPage(backendUrl, undefined, true);
    const scrollIntoView = vi.fn();
    for (const section of view.container.querySelectorAll<HTMLElement>('.settings-section')) {
      section.scrollIntoView = scrollIntoView;
    }

    await screen.findByRole('heading', { name: 'Jarvis', level: 2 });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.getElementById('projects')?.getAttribute('data-open')).toBe('false');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
  it.each([
    { name: 'current Jeppe settings', voice: settings.voice.danishVoice, voices: options.danishVoices },
    { name: 'legacy Harper settings and options', voice: 'da-DK-Harper:MAI-Voice-2', voices: ['da-DK-Harper:MAI-Voice-2'] },
    { name: 'legacy Harper settings with Jeppe options', voice: 'da-DK-Harper:MAI-Voice-2', voices: options.danishVoices },
  ])('shows fixed Jeppe with $name and saves only editable settings', async ({ voice, voices }) => {
    const user = userEvent.setup();
    const current = { ...settings, voice: { ...settings.voice, danishVoice: voice } };
    fetchMock
      .mockResolvedValueOnce(response({
        ...settingsResponse(current),
        options: { ...options, danishVoices: voices },
      }))
      .mockResolvedValueOnce(response(settingsResponse({
        ...settings,
        voice: { ...settings.voice, defaultLanguage: 'en' },
      })));
    renderSettingsPage();

    const danishVoice = await screen.findByRole('textbox', { name: 'Danish voice' });
    expect(danishVoice).toHaveProperty('value', 'Jeppe (Danish)');
    expect(danishVoice).toHaveProperty('readOnly', true);
    expect(danishVoice.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Danish voice' })).toBeNull();
    expect(screen.queryByText(/Harper/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save settings' })).toHaveProperty('disabled', true);

    await user.type(danishVoice, 'Harper');
    expect(danishVoice).toHaveProperty('value', 'Jeppe (Danish)');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default language' }), 'en');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Saved')).not.toBeNull();
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({
      settings: { voice: { defaultLanguage: 'en' } },
    });
    expect(danishVoice).toHaveProperty('value', 'Jeppe (Danish)');
  });

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
    await user.clear(screen.getByRole('spinbutton', { name: 'Screen inspection limit' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Screen inspection limit' }), '240');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Saved')).not.toBeNull();
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

    expect(screen.queryByRole('button', { name: /Play .* sample/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open the Jarvis main page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Trigger Codex renewal' })).toBeNull();
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
    const instructions = screen.getByRole('textbox', { name: 'Custom instructions' });
    expect(instructions).toHaveProperty('maxLength', 2_000);
    expect(instructions.getAttribute('aria-describedby')).toBe('personality-instructions-help');
    expect(screen.getByText('0 / 2,000 characters').id).toBe('personality-instructions-help');
    expect(screen.queryByText('Up to 2,000 characters.')).toBeNull();
    expect(screen.getByRole('button', {
      name: 'Reset personality',
      description: /default personality is already selected/,
    })).toHaveProperty('disabled', true);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Tone' }), 'warm');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Response style' }), 'balanced');
    await user.type(screen.getByRole('textbox', { name: 'Custom instructions' }), updated.personality.customInstructions);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Saved')).not.toBeNull();
    const [, request] = fetchMock.mock.calls[1]!;
    expect(request).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(String(request?.body))).toEqual({ settings: { personality: updated.personality } });
  });

  it('saves the shared identity separately from personality preferences', async () => {
    const user = userEvent.setup();
    const updated = { ...settings, identity: { description: 'I am a broad personal assistant.' } };
    fetchMock.mockResolvedValueOnce(response(settingsResponse()))
      .mockResolvedValueOnce(response(settingsResponse(updated)));
    renderSettingsPage();

    expect(await screen.findByRole('heading', { name: 'Identitet og rolle', level: 2 })).not.toBeNull();
    const description = screen.getByRole('textbox', { name: 'Identity and role description' });
    expect(description).toHaveProperty('maxLength', 2_000);
    expect(description.getAttribute('aria-describedby')).toBe('identity-description-help');
    expect(screen.getByText(/Identity and role guide perspective; Tone and Response style below guide how replies sound/)).not.toBeNull();

    await user.type(description, updated.identity.description);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Saved')).not.toBeNull();
    const [, request] = fetchMock.mock.calls[1]!;
    expect(request).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(String(request?.body))).toEqual({ settings: { identity: updated.identity } });
  });

  it('shows an error when saving the shared identity fails', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response(settingsResponse()))
      .mockResolvedValueOnce(response({ error: 'failed' }, 500));
    renderSettingsPage();

    await user.type(await screen.findByRole('textbox', { name: 'Identity and role description' }), 'Synthetic identity');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Jarvis could not save settings (HTTP 500).');
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
    expect(await screen.findByText('Saved')).not.toBeNull();
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
    expect(await screen.findByText('Reset')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save settings' })).toHaveProperty('disabled', true);
    expect(screen.getByText('The default personality is already selected.')).not.toBeNull();
    const [, request] = fetchMock.mock.calls[2]!;
    expect(JSON.parse(String(request?.body))).toEqual({ settings: { personality: settings.personality } });
  });

  it('offers light, dark, and system modes and saves appearance details at once', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response(settingsResponse()));
    renderSettingsPage();

    await screen.findByRole('heading', { name: 'Appearance', level: 2 });
    expect(screen.queryByText(/light, dark, or system appearance/)).toBeNull();
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('radio', { name: 'System' })).toHaveProperty('disabled', false);
    expect(screen.queryByRole('button', { name: 'Edit theme variables' })).toBeNull();
    await user.click(within(screen.getByRole('group', { name: 'Motion' })).getByRole('button', { name: 'Calm' }));
    expect(themePreference.saveAppearance).toHaveBeenCalledWith({ motion: 'calm' });
    await user.click(within(screen.getByRole('group', { name: 'Density' })).getByRole('button', { name: 'Compact' }));
    expect(themePreference.saveAppearance).toHaveBeenCalledWith({ density: 'compact' });
    // Without custom colours there is nothing to reset.
    expect(screen.queryByRole('button', { name: 'Use Jarvis colours' })).toBeNull();

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
    expect(await screen.findByText('Saved')).not.toBeNull();
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
    expect(screen.getByText('Expires: 5 Oct 2026, 12:00 UTC')).not.toBeNull();
    expect(screen.getByText(/Last renewed:\s*25 Sept 2026, 12:00 UTC/u)).not.toBeNull();
    expect(screen.getByText('Copilot token (jarvis-copilot)')).not.toBeNull();
    expect(screen.getByText('Expires: Not recorded')).not.toBeNull();
    expect(document.body.textContent).not.toContain('SECRET');
  });

  it('keeps one Projects heading and shows defaults save failure with retry', async () => {
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
    let resolveRetry!: (value: Response) => void;
    const retrySave = new Promise<Response>((resolve) => { resolveRetry = resolve; });
    fetchMock.mockResolvedValueOnce(response(settingsResponse()))
      .mockResolvedValueOnce(response({ error: 'Internal server error' }, 500))
      .mockReturnValueOnce(retrySave);
    renderSettingsPage();

    expect(await screen.findByRole('heading', { name: 'Projects', level: 2 })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'New projects' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Defaults for new projects' })).not.toBeNull();
    const policy = screen.getByRole('combobox', { name: 'Policy' });
    expect(policy.getAttribute('aria-describedby')).toBeNull();
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
    const defaults = screen.getByRole('region', { name: 'Defaults for new projects' });
    await user.click(within(defaults).getByRole('button', { name: 'Save settings' }));

    expect((await within(defaults).findByRole('alert')).textContent).toMatch(/could not save settings \(HTTP 500\)/);
    expect(within(defaults).getByRole('textbox', { name: 'Owner' })).toHaveProperty('value', 'jarvis-org');
    await user.click(within(defaults).getByRole('button', { name: 'Retry save' }));
    expect(await within(defaults).findByText('Saving project defaults…')).not.toBeNull();
    expect(within(defaults).queryByText('Project defaults saved.')).toBeNull();
    resolveRetry(response(settingsResponse(updated)));
    expect(await within(defaults).findByText('Project defaults saved.')).not.toBeNull();
    const [, request] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(String(request?.body))).toEqual({ settings: { newProjects: updated.newProjects } });
  });

  it('nests the collapsed defaults disclosure under the existing Projects anchor', async () => {
    const user = userEvent.setup();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, media: '', onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }),
    });
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/settings')) return response(settingsResponse());
      if (url.endsWith('/factory/projects')) return response([]);
      if (url.includes('/factory/repositories')) return response({ repositories: [], fetchedAt: '2026-10-04T09:00:00.000Z' });
      if (url.includes('/factory/tasks')) return response({ tasks: [] });
      return response({ error: 'Unexpected request' }, 500);
    });
    const view = render(
      <ThemePreferenceContext.Provider value={themePreference}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage backendUrl={backendUrl} getAccessToken={getAccessToken}
            renderProjects={(projectDefaults) => (
              <ProjectsPage backendUrl={backendUrl} getAccessToken={getAccessToken} projectDefaults={projectDefaults} />
            )} />
        </MemoryRouter>
      </ThemePreferenceContext.Provider>,
    );

    try {
      const projects = await screen.findByRole('region', { name: 'Projects' });
      expect(projects.id).toBe('projects');
      expect(screen.getAllByRole('heading', { name: 'Projects', level: 2 })).toHaveLength(1);
      expect(screen.queryByRole('heading', { name: 'New projects' })).toBeNull();
      await user.click(within(projects).getByRole('button', { name: 'Projects' }));

      const defaults = within(projects).getByRole('region', { name: 'Defaults for new projects' });
      const disclosure = within(defaults).getByRole('button', { name: 'Defaults for new projects' });
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      await user.click(disclosure);
      expect(within(defaults).getByRole('textbox', { name: 'Owner' })).not.toBeNull();
      expect(within(defaults).getByRole('combobox', { name: 'Visibility' })).not.toBeNull();
      expect(within(defaults).getByRole('textbox', { name: 'Templates repository (owner/name)' })).not.toBeNull();
      expect(within(defaults).getByRole('combobox', { name: 'Default agent' })).not.toBeNull();
      expect(within(defaults).getByRole('combobox', { name: 'Policy' })).not.toBeNull();
      expect(within(defaults).getByRole('spinbutton', { name: 'New project maximum parallel tasks' })).not.toBeNull();
      expect(within(defaults).getByRole('textbox', { name: 'Default branch' })).not.toBeNull();
    } finally {
      view.unmount();
      if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
      else Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
    }
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

    expect(await screen.findByText('Saved')).not.toBeNull();
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

  it('offers the decision service only when the backend supports it and saves the choice', async () => {
    const user = userEvent.setup();
    const supported = { ...options, decisionProviders: ['jev', 'microsoft'] };
    fetchMock.mockResolvedValueOnce(response({
      settings: { ...settings, decisions: { provider: 'jev' } }, options: supported, credentials: [],
    })).mockResolvedValueOnce(response({
      settings: { ...settings, decisions: { provider: 'microsoft' } }, options: supported, credentials: [],
    }));
    renderSettingsPage();

    const select = await screen.findByLabelText('Decision service');
    expect(select).toHaveProperty('value', 'jev');
    expect(within(select).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Jev', 'Microsoft Decision-1']);
    await user.selectOptions(select, 'microsoft');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Saved')).not.toBeNull();
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({
      settings: { decisions: { provider: 'microsoft' } },
    });
    expect(await screen.findByLabelText('Decision service')).toHaveProperty('value', 'microsoft');
  });

  it.each([
    ['omits the decision settings', {}, {}],
    ['reports a provider this page does not list', { decisions: { provider: 'other' } }, { decisionProviders: ['jev', 'microsoft'] }],
  ])('hides the decision service when the backend %s', async (_name, extraSettings, extraOptions) => {
    fetchMock.mockResolvedValueOnce(response({
      settings: { ...settings, ...extraSettings }, options: { ...options, ...extraOptions }, credentials: [],
    }));
    renderSettingsPage();

    await screen.findByRole('checkbox', { name: 'Minimise all windows when starting voice' });
    expect(screen.queryByLabelText('Decision service')).toBeNull();
  });

  it('offers retry when settings cannot be loaded', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(settingsResponse()));
    renderSettingsPage();

    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
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
    expect(await screen.findByText('Saved')).not.toBeNull();
  });

  it('settles into a visible unavailable state without a backend URL', async () => {
    renderSettingsPage(null);

    expect((await screen.findAllByRole('alert'))[0]!.textContent).toMatch(/Settings unavailable/);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('puts the nutrition section after the projects and outside the settings form, only when it is supplied', async () => {
    fetchMock.mockResolvedValueOnce(response(settingsResponse()));
    const view = render(
      <ThemePreferenceContext.Provider value={themePreference}>
        <SettingsPage backendUrl={backendUrl} getAccessToken={getAccessToken}
          projects={<section aria-label="Projects stand-in" />}
          nutrition={<section aria-label="Nutrition stand-in" />} />
      </ThemePreferenceContext.Provider>,
    );
    const projects = await screen.findByRole('region', { name: 'Projects stand-in' });
    const nutrition = screen.getByRole('region', { name: 'Nutrition stand-in' });
    expect(projects.compareDocumentPosition(nutrition) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nutrition.closest('form')).toBeNull();
    view.unmount();

    fetchMock.mockResolvedValueOnce(response(settingsResponse()));
    renderSettingsPage();
    await screen.findByRole('button', { name: 'Save settings' });
    expect(screen.queryByRole('region', { name: 'Nutrition stand-in' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Nutrition targets' })).toBeNull();
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/daily/'))).toBe(true);
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
      if (url.endsWith('/settings') && init?.method === 'PATCH') return response({ settings: advanced, options: advancedOptions, credentials: [], modelWarnings: {} });
      return response({
        settings: advanced, options: advancedOptions, credentials: [],
        modelWarnings: { research: 'The saved Research model is not supported by the Codex runtime. gpt-5.6-luna is used instead; choose a supported model to update it.' },
      });
    });
    renderSettingsPage();

    await screen.findByRole('heading', { name: 'Models', level: 2 });
    const modelsToggle = screen.getByRole('button', { name: /^Models/ });
    await user.click(modelsToggle);
    expect(await within(modelsToggle).findByText(/ · 1 deployment$/)).not.toBeNull();
    const modelWarning = await screen.findByText(/not supported by the Codex runtime/);
    expect(modelWarning.getAttribute('role')).toBe('status');
    await user.click(modelsToggle);
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

    expect(await screen.findByText('Saved')).not.toBeNull();
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

  it.each([
    [1, 'Quick · up to 1 source'],
    [2, 'Quick · up to 2 sources'],
  ])('words the folded research summary for %i source(s) in the right number', async (maxSources, summary) => {
    const user = userEvent.setup();
    try {
      render(<ResearchSection research={{ depth: 'quick', maxSources, timeoutSeconds: 60 }} problems={{}}
        disabled={false} onChange={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /^Research/ }));
      expect(screen.getByText(summary)).not.toBeNull();
    } finally {
      localStorage.removeItem('jarvis.sections.settings.research');
    }
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

  it('saves the check repair attempts and the daily watch budget', async () => {
    const user = userEvent.setup();
    const withLimits = { ...settings, global: { ...settings.global, maxCheckAttempts: 3, visionDailyBudgetUsd: 1 } };
    fetchMock.mockResolvedValueOnce(response(settingsResponse(withLimits)))
      .mockResolvedValueOnce(response(settingsResponse({ ...withLimits, global: { ...withLimits.global, maxCheckAttempts: 5, visionDailyBudgetUsd: 2.5 } })));
    renderSettingsPage();
    const attempts = await screen.findByRole('spinbutton', { name: 'Check repair attempts' });
    await user.clear(attempts);
    await user.type(attempts, '5');
    const budget = screen.getByRole('spinbutton', { name: 'Per-day watch budget (USD)' });
    await user.clear(budget);
    await user.type(budget, '2.5');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await screen.findByText('Saved');
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ settings: { global: { maxCheckAttempts: 5, visionDailyBudgetUsd: 2.5 } } });
    expectNoDailyInRenderedContent(document.body);
  });

  it('renews the Codex credential on request and reports a busy agent', async () => {
    const user = userEvent.setup();
    const codex = { name: 'codex-login', expiresAt: null, lastRenewedAt: null, status: 'renew_soon' as const };
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/settings/credentials/codex-login/renew')) {
        return fetchMock.mock.calls.filter(([called]) => String(called).endsWith('/renew')).length === 1
          ? response({ error: 'Codex credential is busy; retry later', credential: codex }, 409)
          : response({ credential: { ...codex, status: 'ok', lastRenewedAt: '2026-10-08T15:00:00.000Z' } });
      }
      return response(settingsResponse(settings, [codex, { name: 'copilot-token', expiresAt: null, lastRenewedAt: null, status: 'ok' }]));
    });
    renderSettingsPage();
    const renew = await screen.findByRole('button', { name: 'Renew' });
    expect(screen.getAllByRole('button', { name: 'Renew' })).toHaveLength(1);
    await user.click(renew);
    expect(await screen.findByText('Codex is busy with a task. Try again when it finishes.')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Renew' }));
    expect(await screen.findByText('Renewed.')).not.toBeNull();
    expect(screen.getAllByText('Status: OK')).toHaveLength(2);
  });
});