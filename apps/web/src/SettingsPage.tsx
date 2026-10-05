import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { backendFetch } from './backend-request';
import { useThemePreference } from './theme-preference-context';
import { readVoiceWorkspacePreference, saveVoiceWorkspacePreference } from './voice-workspace-preference';

interface Settings {
  appearance: { theme: 'light' | 'dark' };
  jarvis: { model: string; reasoning: string };
  voice: {
    speechToTextModel: string;
    englishModel: string;
    englishVoice: string;
    danishVoice: string;
    defaultLanguage: 'da' | 'en';
  };
  codex: { model: string; reasoning: string };
  copilot: { model: string };
  global: { maxParallelTasks: number; screenShareDailyFrameCap: number };
  newProjects: {
    owner: string;
    visibility: 'private' | 'public';
    templatesRepository: string;
    defaultAgent: 'codex' | 'copilot';
    policy: 'deliver_pr' | 'complete_without_deployment';
    maxParallelTasks: number;
    defaultBranch: string;
  };
}

type SettingsPatch = { [Area in keyof Settings]?: Partial<Settings[Area]> };

interface SettingsOptions {
  themes: string[];
  jarvisModels: string[];
  reasoningEfforts: string[];
  speechToTextModels: string[];
  englishModels: string[];
  englishVoices: string[];
  danishVoices: string[];
  languages: string[];
  codexModels: string[];
  codexReasoningEfforts: string[];
  copilotModels: string[];
  projectVisibilities: string[];
  projectAgents: string[];
  projectPolicies: string[];
}

interface CredentialStatus {
  name: 'codex-login' | 'copilot-token';
  expiresAt: string | null;
  lastRenewedAt: string | null;
  status: 'ok' | 'renew_soon' | 'failed' | 'unknown';
}

interface SettingsResponse { settings: Settings; options: SettingsOptions; credentials: CredentialStatus[] }
type LoadState = 'loading' | 'ready' | 'error';

const optionLabels: Record<string, string> = {
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'gpt-realtime-2.1': 'GPT Realtime 2.1',
  'mai-transcribe': 'MAI Transcribe',
  'en-GB-Ryan:DragonHDLatestNeural': 'Ryan HD (British English)',
  'da-DK-Harper:MAI-Voice-2': 'Harper (Danish)',
  da: 'Danish',
  en: 'English',
  default: 'Provider default',
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  private: 'Private',
  public: 'Public',
  codex: 'Codex',
  copilot: 'Copilot',
  deliver_pr: 'Deliver a pull request',
  complete_without_deployment: 'Complete without deployment',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSettingsResponse(value: unknown): value is SettingsResponse {
  if (!isObject(value) || !isObject(value.settings) || !isObject(value.options)) return false;
  const settings = value.settings;
  const options = value.options;
  const credentials = value.credentials;
  const optionKeys: (keyof SettingsOptions)[] = [
    'themes', 'jarvisModels', 'reasoningEfforts', 'speechToTextModels', 'englishModels',
    'englishVoices', 'danishVoices', 'languages', 'codexModels',
    'codexReasoningEfforts', 'copilotModels', 'projectVisibilities', 'projectAgents',
    'projectPolicies',
  ];
  const validOptions = optionKeys.every((key) =>
    Array.isArray(options[key]) && (options[key] as unknown[]).every((item) => typeof item === 'string'));
  const validCredentials = Array.isArray(credentials) && credentials.every((item) =>
    isObject(item) && (item.name === 'codex-login' || item.name === 'copilot-token') &&
    (item.status === 'ok' || item.status === 'renew_soon' || item.status === 'failed' || item.status === 'unknown') &&
    (item.expiresAt === null || (typeof item.expiresAt === 'string' && Number.isFinite(Date.parse(item.expiresAt)))) &&
    (item.lastRenewedAt === null || (typeof item.lastRenewedAt === 'string' && Number.isFinite(Date.parse(item.lastRenewedAt)))));
  return isObject(settings.appearance) &&
    (settings.appearance.theme === 'light' || settings.appearance.theme === 'dark') &&
    isObject(settings.jarvis) && isObject(settings.voice) && isObject(settings.codex) &&
    isObject(settings.copilot) && isObject(settings.global) && isObject(settings.newProjects) &&
    typeof settings.jarvis.model === 'string' && typeof settings.jarvis.reasoning === 'string' &&
    typeof settings.voice.speechToTextModel === 'string' && typeof settings.voice.englishModel === 'string' &&
    typeof settings.voice.englishVoice === 'string' && typeof settings.voice.danishVoice === 'string' &&
    (settings.voice.defaultLanguage === 'da' || settings.voice.defaultLanguage === 'en') &&
    typeof settings.codex.model === 'string' && typeof settings.codex.reasoning === 'string' &&
    typeof settings.copilot.model === 'string' && typeof settings.global.maxParallelTasks === 'number' &&
    Number.isSafeInteger(settings.global.maxParallelTasks) &&
    settings.global.maxParallelTasks >= 1 && settings.global.maxParallelTasks <= 100 &&
    typeof settings.global.screenShareDailyFrameCap === 'number' &&
    Number.isSafeInteger(settings.global.screenShareDailyFrameCap) &&
    settings.global.screenShareDailyFrameCap >= 1 && settings.global.screenShareDailyFrameCap <= 300 &&
    typeof settings.newProjects.owner === 'string' &&
    (settings.newProjects.visibility === 'private' || settings.newProjects.visibility === 'public') &&
    typeof settings.newProjects.templatesRepository === 'string' &&
    (settings.newProjects.defaultAgent === 'codex' || settings.newProjects.defaultAgent === 'copilot') &&
    (settings.newProjects.policy === 'deliver_pr' || settings.newProjects.policy === 'complete_without_deployment') &&
    typeof settings.newProjects.maxParallelTasks === 'number' &&
    Number.isSafeInteger(settings.newProjects.maxParallelTasks) &&
    settings.newProjects.maxParallelTasks >= 1 && settings.newProjects.maxParallelTasks <= 100 &&
    typeof settings.newProjects.defaultBranch === 'string' &&
    validOptions && validCredentials;
}

const credentialNames: Record<CredentialStatus['name'], string> = {
  'codex-login': 'Codex login',
  'copilot-token': 'Copilot token (jarvis-copilot)',
};
const credentialStatusLabels: Record<CredentialStatus['status'], string> = {
  ok: 'OK',
  renew_soon: 'Renew soon',
  failed: 'Action needed',
  unknown: 'Unknown',
};

function formatCredentialDate(value: string | null): string {
  if (value === null) return 'Not recorded';
  return `${new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  }).format(new Date(value))} UTC`;
}

function changedSettings(before: Settings, after: Settings): SettingsPatch {
  const patch: Record<string, Record<string, unknown>> = {};
  for (const area of Object.keys(after) as (keyof Settings)[]) {
    for (const key of Object.keys(after[area]) as (keyof Settings[typeof area])[]) {
      if (before[area][key] !== after[area][key]) {
        (patch[area] ??= {})[key as string] = after[area][key];
      }
    }
  }
  return patch as SettingsPatch;
}

async function requestSettings(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  method: 'GET' | 'PATCH',
  settings?: SettingsPatch,
): Promise<SettingsResponse> {
  let response: Response;
  try {
    const bearerScheme = ['Bear', 'er'].join('');
    response = await backendFetch(`${backendUrl}/settings`, {
      method,
      headers: {
        Authorization: `${bearerScheme} ${await getAccessToken()}`,
        ...(settings ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(settings ? { body: JSON.stringify({ settings }) } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Your Microsoft sign-in needs attention. Sign in again.') throw error;
    throw new Error('Jarvis could not reach the settings service. Try again.', { cause: error });
  }
  if (response.status === 401) throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
  if (response.status === 503) throw new Error('Settings are unavailable until the database is connected.');
  if (!response.ok) throw new Error(`Jarvis could not ${method === 'GET' ? 'load' : 'save'} settings (HTTP ${response.status}).`);
  let result: unknown;
  try { result = await response.json(); } catch { throw new Error('Jarvis returned invalid settings. Try again.'); }
  if (!isSettingsResponse(result)) throw new Error('Jarvis returned invalid settings. Try again.');
  return result;
}

function SelectField({
  id, label, value, options, onChange, disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="settings-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{optionLabels[option] ?? option}</option>)}
      </select>
    </div>
  );
}

export function SettingsPage({ backendUrl, getAccessToken }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
}) {
  const themePreference = useThemePreference();
  const [state, setState] = useState<LoadState>(backendUrl ? 'loading' : 'error');
  const [savedSettings, setSavedSettings] = useState<Settings | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [options, setOptions] = useState<SettingsOptions | null>(null);
  const [credentials, setCredentials] = useState<CredentialStatus[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(backendUrl ? '' : 'Settings are unavailable until the backend is deployed.');
  const [minimizeWindowsOnVoiceStart, setMinimizeWindowsOnVoiceStart] = useState(
    () => readVoiceWorkspacePreference().voice.minimizeWindowsOnVoiceStart,
  );
  const [voicePreferenceMessage, setVoicePreferenceMessage] = useState('');
  const [voicePreferenceError, setVoicePreferenceError] = useState('');

  const load = useCallback(async () => {
    if (!backendUrl) {
      setError('Settings are unavailable until the backend is deployed.');
      setState('error');
      return;
    }
    setError('');
    setState('loading');
    try {
      const result = await requestSettings(backendUrl, getAccessToken, 'GET');
      setSavedSettings(result.settings);
      setSettings(result.settings);
      setOptions(result.options);
      setCredentials(result.credentials);
      setState('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Settings could not be loaded. Try again.');
      setState('error');
    }
  }, [backendUrl, getAccessToken]);

  useEffect(() => {
    if (!backendUrl) return;
    let active = true;
    void requestSettings(backendUrl, getAccessToken, 'GET').then((result) => {
      if (!active) return;
      setSavedSettings(result.settings);
      setSettings(result.settings);
      setOptions(result.options);
      setCredentials(result.credentials);
      setState('ready');
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : 'Settings could not be loaded. Try again.');
      setState('error');
    });
    return () => { active = false; };
  }, [backendUrl, getAccessToken]);

  const update = <Area extends keyof Settings, Key extends keyof Settings[Area]>(
    area: Area,
    key: Key,
    value: Settings[Area][Key],
  ) => {
    setSettings((current) => current ? ({
      ...current,
      [area]: { ...current[area], [key]: value },
    }) : current);
    setMessage('');
  };

  const updateVoiceWorkspacePreference = (value: boolean) => {
    try {
      saveVoiceWorkspacePreference(value);
      setMinimizeWindowsOnVoiceStart(value);
      setVoicePreferenceMessage('Saved on this device.');
      setVoicePreferenceError('');
    } catch {
      setVoicePreferenceError('This preference could not be saved on this device.');
      setVoicePreferenceMessage('');
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings || !savedSettings || !backendUrl || saving) return;
    const patch = changedSettings(savedSettings, settings);
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await requestSettings(backendUrl, getAccessToken, 'PATCH', patch);
      setSavedSettings(result.settings);
      setSettings(result.settings);
      setOptions(result.options);
      setMessage('Saved. These are defaults for new sessions and tasks; running work keeps its current settings.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Settings could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const dirty = settings !== null && savedSettings !== null &&
    Object.keys(changedSettings(savedSettings, settings)).length > 0;
  const maxTasksValid = settings !== null && Number.isSafeInteger(settings.global.maxParallelTasks) &&
    settings.global.maxParallelTasks >= 1 && settings.global.maxParallelTasks <= 100;
  const newProjectMaxTasksValid = settings !== null && Number.isSafeInteger(settings.newProjects.maxParallelTasks) &&
    settings.newProjects.maxParallelTasks >= 1 && settings.newProjects.maxParallelTasks <= 100;

  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <h1 id="settings-heading">Settings</h1>
      {state === 'loading' && <p role="status">Loading settings…</p>}
      {state === 'error' && (
        <div className="settings-feedback" role="alert">
          <p>{error}</p>
          {backendUrl && <button className="secondary-button" type="button" onClick={() => { void load(); }}>Retry</button>}
        </div>
      )}
      {state === 'ready' && settings && options && (
        <form onSubmit={(event) => { void save(event); }}>
          <section className="settings-section" aria-labelledby="appearance-settings-heading">
            <h2 id="appearance-settings-heading">Appearance</h2>
            <p className="settings-explanation">Choose a light or dark appearance for every page. The accepted theme is saved separately from other settings.</p>
            <fieldset className="choice-group theme-choice-group"
              disabled={themePreference.state !== 'ready' || themePreference.saving}>
              <legend>Theme</legend>
              <label className="choice" htmlFor="theme-light">
                <input id="theme-light" name="theme" type="radio" value="light"
                  checked={themePreference.theme === 'light'}
                  onChange={() => { void themePreference.saveTheme('light'); }} />
                Light
              </label>
              <label className="choice" htmlFor="theme-dark">
                <input id="theme-dark" name="theme" type="radio" value="dark"
                  checked={themePreference.theme === 'dark'}
                  onChange={() => { void themePreference.saveTheme('dark'); }} />
                Dark
              </label>
            </fieldset>
            {themePreference.state === 'loading' && <p className="settings-feedback" role="status">Loading saved theme…</p>}
            {themePreference.state === 'error' && (
              <div className="settings-feedback" role="alert">
                <p>{themePreference.error}</p>
                <button className="secondary-button" type="button" onClick={themePreference.retry}>Retry theme</button>
              </div>
            )}
            {themePreference.state === 'ready' && themePreference.saving &&
              <p className="settings-feedback" role="status">Saving theme…</p>}
            {themePreference.state === 'ready' && themePreference.error &&
              <p className="settings-feedback" role="alert">{themePreference.error}</p>}
            {themePreference.state === 'ready' && !themePreference.error && themePreference.message &&
              <p className="settings-feedback" role="status">{themePreference.message}</p>}
            <button className="secondary-button theme-variable-button" type="button" disabled
              aria-describedby="theme-variables-help">Edit theme variables</button>
            <p className="settings-explanation" id="theme-variables-help">
              Custom and Jarvis-directed variable changes are unavailable until their validated settings and tool update path is implemented.
            </p>
          </section>

          <section className="settings-section" aria-labelledby="jarvis-settings-heading">
            <h2 id="jarvis-settings-heading">Jarvis</h2>
            <div className="settings-grid">
              <SelectField id="jarvis-model" label="Chat and Danish voice model" value={settings.jarvis.model}
                options={options.jarvisModels} disabled={saving}
                onChange={(value) => update('jarvis', 'model', value)} />
              <SelectField id="jarvis-reasoning" label="Reasoning effort" value={settings.jarvis.reasoning}
                options={options.reasoningEfforts} disabled={saving}
                onChange={(value) => update('jarvis', 'reasoning', value)} />
            </div>
            <p className="settings-explanation">Model choices are limited to deployments currently configured for Jarvis.</p>
          </section>

          <section className="settings-section" aria-labelledby="voice-settings-heading">
            <h2 id="voice-settings-heading">Voice</h2>
            <div className="settings-grid">
              <SelectField id="speech-model" label="Speech-to-text model" value={settings.voice.speechToTextModel}
                options={options.speechToTextModels} disabled={saving}
                onChange={(value) => update('voice', 'speechToTextModel', value)} />
              <SelectField id="english-voice-model" label="English speech-to-speech model" value={settings.voice.englishModel}
                options={options.englishModels} disabled={saving}
                onChange={(value) => update('voice', 'englishModel', value)} />
              <SelectField id="english-voice" label="English voice" value={settings.voice.englishVoice}
                options={options.englishVoices} disabled={saving}
                onChange={(value) => update('voice', 'englishVoice', value)} />
              <SelectField id="danish-voice" label="Danish voice" value={settings.voice.danishVoice}
                options={options.danishVoices} disabled={saving}
                onChange={(value) => update('voice', 'danishVoice', value)} />
              <SelectField id="default-language" label="Default language" value={settings.voice.defaultLanguage}
                options={options.languages} disabled={saving}
                onChange={(value) => update('voice', 'defaultLanguage', value as 'da' | 'en')} />
            </div>
            <label className="choice voice-window-preference" htmlFor="minimize-windows-on-voice-start">
              <input id="minimize-windows-on-voice-start" type="checkbox"
                checked={minimizeWindowsOnVoiceStart}
                onChange={(event) => updateVoiceWorkspacePreference(event.target.checked)} />
              Minimise all windows when starting voice
            </label>
            <p className="settings-explanation">Off by default. This preference is saved on this device until account settings persistence is available.</p>
            {voicePreferenceError && <p className="settings-feedback" role="alert">{voicePreferenceError}</p>}
            {!voicePreferenceError && voicePreferenceMessage &&
              <p className="settings-feedback" role="status">{voicePreferenceMessage}</p>}
            <p className="settings-explanation" id="voice-sample-help">Voice samples will be available when voice playback is connected.</p>
            <div className="settings-actions">
              <button className="secondary-button" type="button" disabled aria-describedby="voice-sample-help">Play English sample</button>
              <button className="secondary-button" type="button" disabled aria-describedby="voice-sample-help">Play Danish sample</button>
            </div>
          </section>

          <section className="settings-section" aria-labelledby="coding-settings-heading">
            <h2 id="coding-settings-heading">Coding agents</h2>
            <div className="settings-grid">
              <SelectField id="codex-model" label="Codex model" value={settings.codex.model}
                options={options.codexModels} disabled={saving}
                onChange={(value) => update('codex', 'model', value)} />
              <SelectField id="codex-reasoning" label="Codex reasoning effort" value={settings.codex.reasoning}
                options={options.codexReasoningEfforts} disabled={saving}
                onChange={(value) => update('codex', 'reasoning', value)} />
              <SelectField id="copilot-model" label="Copilot model" value={settings.copilot.model}
                options={options.copilotModels} disabled={saving}
                onChange={(value) => update('copilot', 'model', value)} />
            </div>
            <p className="settings-explanation">Only verified provider choices are offered. Additional agent model choices depend on provider support verification.</p>
          </section>

          <section className="settings-section" aria-labelledby="global-settings-heading">
            <h2 id="global-settings-heading">Global</h2>
            <div className="settings-field settings-number-field">
              <label htmlFor="max-parallel-tasks">Maximum parallel tasks</label>
              <input id="max-parallel-tasks" type="number" min="1" max="100" step="1"
                value={settings.global.maxParallelTasks} disabled={saving}
                onChange={(event) => update('global', 'maxParallelTasks', Number(event.target.value))} />
              <p className="settings-explanation">Choose a whole number from 1 to 100.</p>
            </div>
            <div className="settings-field settings-number-field">
              <label htmlFor="screen-share-daily-frame-cap">Daily screen inspection limit</label>
              <input id="screen-share-daily-frame-cap" type="number" min="1" max="300" step="1"
                value={settings.global.screenShareDailyFrameCap} disabled={saving}
                onChange={(event) => update('global', 'screenShareDailyFrameCap', Number(event.target.value))} />
              <p className="settings-explanation">Maximum screen frames sent to the vision model per UTC day (1–300).</p>
            </div>
            <p className="settings-explanation" id="sleep-switch-help">Manage backend sleep from the Jarvis main page.</p>
            <a className="home-link" href="/" aria-describedby="sleep-switch-help">Open the Jarvis main page</a>
          </section>

          <section className="settings-section" aria-labelledby="new-projects-settings-heading">
            <h2 id="new-projects-settings-heading">New projects</h2>
            <div className="settings-grid">
              <div className="settings-field">
                <label htmlFor="new-project-owner">Owner</label>
                <input id="new-project-owner" maxLength={39} value={settings.newProjects.owner} disabled={saving}
                  onChange={(event) => update('newProjects', 'owner', event.target.value)} />
              </div>
              <SelectField id="new-project-visibility" label="Visibility" value={settings.newProjects.visibility}
                options={options.projectVisibilities} disabled={saving}
                onChange={(value) => update('newProjects', 'visibility', value as 'private' | 'public')} />
              <div className="settings-field">
                <label htmlFor="new-project-templates">Templates repository (owner/name)</label>
                <input id="new-project-templates" maxLength={140} value={settings.newProjects.templatesRepository} disabled={saving}
                  onChange={(event) => update('newProjects', 'templatesRepository', event.target.value)} />
              </div>
              <SelectField id="new-project-agent" label="Default agent" value={settings.newProjects.defaultAgent}
                options={options.projectAgents} disabled={saving}
                onChange={(value) => update('newProjects', 'defaultAgent', value as 'codex' | 'copilot')} />
              <SelectField id="new-project-policy" label="Policy" value={settings.newProjects.policy}
                options={options.projectPolicies} disabled={saving}
                onChange={(value) => update('newProjects', 'policy', value as Settings['newProjects']['policy'])} />
              <div className="settings-field">
                <label htmlFor="new-project-max-tasks">New project maximum parallel tasks</label>
                <input id="new-project-max-tasks" type="number" min="1" max="100" step="1"
                  value={settings.newProjects.maxParallelTasks} disabled={saving}
                  onChange={(event) => update('newProjects', 'maxParallelTasks', Number(event.target.value))} />
              </div>
              <div className="settings-field">
                <label htmlFor="new-project-branch">Default branch</label>
                <input id="new-project-branch" maxLength={255} value={settings.newProjects.defaultBranch} disabled={saving}
                  onChange={(event) => update('newProjects', 'defaultBranch', event.target.value)} />
              </div>
            </div>
            <p className="settings-explanation">
              These defaults are used when Jarvis registers a new project. Use a GitHub account or organization name,
              a templates repository in owner/name format, and a valid branch name.
            </p>
            <p className="settings-explanation">New project task limits must be whole numbers from 1 to 100.</p>
          </section>

          <section className="settings-section" aria-labelledby="credentials-heading">
            <h2 id="credentials-heading">Credentials</h2>
            <p className="settings-explanation" id="credential-actions-help">
              Renewal runs daily when no Codex task is active. Manual renewal and re-seed instructions are unavailable here. Secret values are never shown.
            </p>
            {credentials.length === 0
              ? <p role="status">No credential status has been recorded yet.</p>
              : (
                <div className="settings-grid">
                  {credentials.map((credential) => (
                    <div className="settings-field" key={credential.name}>
                      <strong>{credentialNames[credential.name]}</strong>
                      <span>Status: {credentialStatusLabels[credential.status]}</span>
                      <span>Expires: {formatCredentialDate(credential.expiresAt)}</span>
                      <span>Last renewed: {formatCredentialDate(credential.lastRenewedAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            <div className="settings-actions">
              <button className="secondary-button" type="button" disabled aria-describedby="credential-actions-help">Trigger Codex renewal</button>
              <button className="secondary-button" type="button" disabled aria-describedby="credential-actions-help">Open re-seed instructions</button>
            </div>
          </section>

          <div className="settings-save">
            <button className="primary-button" type="submit"
              disabled={!dirty || !maxTasksValid || !newProjectMaxTasksValid || saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            <p className="settings-feedback" role={error ? 'alert' : 'status'} aria-live="polite">
              {error || message}
            </p>
          </div>
        </form>
      )}
    </section>
  );
}
