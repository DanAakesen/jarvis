import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface Settings {
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
  global: { maxParallelTasks: number };
}

type SettingsPatch = { [Area in keyof Settings]?: Partial<Settings[Area]> };

interface SettingsOptions {
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
}

interface SettingsResponse { settings: Settings; options: SettingsOptions }
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
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSettingsResponse(value: unknown): value is SettingsResponse {
  if (!isObject(value) || !isObject(value.settings) || !isObject(value.options)) return false;
  const settings = value.settings;
  const options = value.options;
  const optionKeys: (keyof SettingsOptions)[] = [
    'jarvisModels', 'reasoningEfforts', 'speechToTextModels', 'englishModels',
    'englishVoices', 'danishVoices', 'languages', 'codexModels',
    'codexReasoningEfforts', 'copilotModels',
  ];
  const validOptions = optionKeys.every((key) =>
    Array.isArray(options[key]) && (options[key] as unknown[]).every((item) => typeof item === 'string'));
  return isObject(settings.jarvis) && isObject(settings.voice) && isObject(settings.codex) &&
    isObject(settings.copilot) && isObject(settings.global) &&
    typeof settings.jarvis.model === 'string' && typeof settings.jarvis.reasoning === 'string' &&
    typeof settings.voice.speechToTextModel === 'string' && typeof settings.voice.englishModel === 'string' &&
    typeof settings.voice.englishVoice === 'string' && typeof settings.voice.danishVoice === 'string' &&
    (settings.voice.defaultLanguage === 'da' || settings.voice.defaultLanguage === 'en') &&
    typeof settings.codex.model === 'string' && typeof settings.codex.reasoning === 'string' &&
    typeof settings.copilot.model === 'string' && typeof settings.global.maxParallelTasks === 'number' &&
    Number.isSafeInteger(settings.global.maxParallelTasks) &&
    settings.global.maxParallelTasks >= 1 && settings.global.maxParallelTasks <= 100 && validOptions;
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
    response = await fetch(`${backendUrl}/settings`, {
      method,
      headers: {
        Authorization: `${bearerScheme} ${await getAccessToken()}`,
        ...(settings ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(settings ? { body: JSON.stringify({ settings }) } : {}),
      signal: AbortSignal.timeout(10_000),
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
  const [state, setState] = useState<LoadState>(backendUrl ? 'loading' : 'error');
  const [savedSettings, setSavedSettings] = useState<Settings | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [options, setOptions] = useState<SettingsOptions | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(backendUrl ? '' : 'Settings are unavailable until the backend is deployed.');

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
            <p className="settings-explanation" id="sleep-switch-help">Manage backend sleep from the Jarvis main page.</p>
            <a className="home-link" href="/" aria-describedby="sleep-switch-help">Open the Jarvis main page</a>
          </section>

          <section className="settings-section" aria-labelledby="credentials-heading">
            <h2 id="credentials-heading">Credentials</h2>
            <p className="settings-explanation" id="credential-actions-help">
              Credential names, expiry, last renewal and status will appear here. Secret values are never shown.
            </p>
            <div className="settings-actions">
              <button className="secondary-button" type="button" disabled aria-describedby="credential-actions-help">Trigger Codex renewal</button>
              <button className="secondary-button" type="button" disabled aria-describedby="credential-actions-help">Open re-seed instructions</button>
            </div>
          </section>

          <div className="settings-save">
            <button className="primary-button" type="submit" disabled={!dirty || !maxTasksValid || saving}>
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
