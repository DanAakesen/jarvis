import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { backendFetch } from './backend-request';
import { useThemePreference } from './theme-preference-context';
import { saveVoiceWorkspacePreference } from './voice-workspace-preference';
import { TaskRecipesSettings } from './TaskRecipesSettings';
import { Loader } from './Loader';
import { StateMessage } from './StateMessage';
import { CollapsibleSection } from './CollapsibleSection';
import { useWakeStatus } from './wake-store';
import { AppearanceDetails, ModelsSection, ResearchSection, RetrievalSection, TimeoutsSection, VoiceTuningFields } from './SettingsAdvanced';
import { revealWhenReady } from './page-navigation';
import {
  advancedProblems, isRoleOptions, isRoleSettings,
  type MemorySettings, type ModelRole, type ResearchSettings, type RoleSettings, type TimeoutSettings, type VoiceTuningSettings,
} from './settings-advanced-data';
import { formatDateTime, formatTimeOnly } from './format/date-time';

interface Settings {
  appearance: { theme: 'light' | 'dark' | 'system' };
  jarvis: { model: string; reasoning: string };
  personality: {
    tone: 'british_butler' | 'warm' | 'direct' | 'playful';
    responseStyle: 'concise' | 'balanced' | 'detailed';
    customInstructions: string;
  };
  voice: {
    speechToTextModel: string;
    englishModel: string;
    englishVoice: string;
    danishVoice: string;
    defaultLanguage: 'da' | 'en';
    minimizeWindowsOnVoiceStart: boolean;
  } & Partial<VoiceTuningSettings>;
  /** Present on backends with role-based models and tuning (P9-13); older backends omit them. */
  roles?: RoleSettings;
  research?: ResearchSettings;
  memory?: MemorySettings;
  timeouts?: TimeoutSettings;
  /** Which service scores decisions (Jarvis reflexes, browser and PC steps); newer backends only. */
  decisions?: { provider: 'jev' | 'microsoft' };
  codex: { model: string; reasoning: string };
  copilot: { model: string };
  global: { maxParallelTasks: number; screenShareDailyFrameCap: number; maxCheckAttempts?: number; visionDailyBudgetUsd?: number };
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
  personalityTones: Settings['personality']['tone'][];
  personalityResponseStyles: Settings['personality']['responseStyle'][];
  speechToTextModels: string[];
  englishModels: string[];
  englishVoices: string[];
  danishVoices: string[];
  languages: string[];
  codexModels: string[];
  codexReasoningEfforts: string[];
  copilotModels: string[];
  decisionProviders?: string[];
  projectVisibilities: string[];
  projectAgents: string[];
  projectPolicies: string[];
  roles?: unknown;
}

interface CredentialStatus {
  /** Known names get friendly labels; new credentials the backend adds still show, under their own name. */
  name: string;
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
  jev: 'Jev',
  microsoft: 'Microsoft Decision-1',
  british_butler: 'British butler',
  warm: 'Warm',
  direct: 'Direct',
  playful: 'Playful',
  concise: 'Concise',
  balanced: 'Balanced',
  detailed: 'Detailed',
  'en-GB-Ryan:DragonHDLatestNeural': 'Ryan HD (British English)',
  'da-DK-JeppeNeural': 'Jeppe (Danish)',
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

const settingsDeepLinkIds = new Set(['health-upload', 'projects', 'proactive-settings', 'nutrition-targets']);

const defaultPersonality: Settings['personality'] = {
  tone: 'british_butler',
  responseStyle: 'concise',
  customInstructions: '',
};

function cacheVoiceWorkspacePreference(minimizeWindowsOnVoiceStart: boolean) {
  try {
    saveVoiceWorkspacePreference(minimizeWindowsOnVoiceStart);
  } catch {
    return;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasUnsupportedControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 && character !== '\n' && character !== '\r' && character !== '\t';
  });
}

function isSettingsResponse(value: unknown): value is SettingsResponse {
  if (!isObject(value) || !isObject(value.settings) || !isObject(value.options)) return false;
  const settings = value.settings;
  const options = value.options;
  const credentials = value.credentials;
  const optionKeys: (keyof SettingsOptions)[] = [
    'themes', 'jarvisModels', 'reasoningEfforts', 'personalityTones', 'personalityResponseStyles',
    'speechToTextModels', 'englishModels',
    'englishVoices', 'danishVoices', 'languages', 'codexModels',
    'codexReasoningEfforts', 'copilotModels', 'projectVisibilities', 'projectAgents',
    'projectPolicies',
  ];
  const validOptions = optionKeys.every((key) =>
    Array.isArray(options[key]) && (options[key] as unknown[]).every((item) => typeof item === 'string'));
  const validCredentials = Array.isArray(credentials) && credentials.every((item) =>
    isObject(item) && typeof item.name === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(item.name) &&
    (item.status === 'ok' || item.status === 'renew_soon' || item.status === 'failed' || item.status === 'unknown') &&
    (item.expiresAt === null || (typeof item.expiresAt === 'string' && Number.isFinite(Date.parse(item.expiresAt)))) &&
    (item.lastRenewedAt === null || (typeof item.lastRenewedAt === 'string' && Number.isFinite(Date.parse(item.lastRenewedAt)))));
  return validOptions && validCredentials &&
    isObject(settings.appearance) &&
    (settings.appearance.theme === 'light' || settings.appearance.theme === 'dark' ||
      settings.appearance.theme === 'system') &&
    isObject(settings.jarvis) && isObject(settings.personality) && isObject(settings.voice) && isObject(settings.codex) &&
    isObject(settings.copilot) && isObject(settings.global) && isObject(settings.newProjects) &&
    typeof settings.jarvis.model === 'string' && typeof settings.jarvis.reasoning === 'string' &&
    typeof settings.personality.tone === 'string' &&
    (options.personalityTones as string[]).includes(settings.personality.tone) &&
    typeof settings.personality.responseStyle === 'string' &&
    (options.personalityResponseStyles as string[]).includes(settings.personality.responseStyle) &&
    typeof settings.personality.customInstructions === 'string' &&
    settings.personality.customInstructions.length <= 2_000 &&
    !hasUnsupportedControlCharacters(settings.personality.customInstructions) &&
    typeof settings.voice.speechToTextModel === 'string' && typeof settings.voice.englishModel === 'string' &&
    typeof settings.voice.englishVoice === 'string' && typeof settings.voice.danishVoice === 'string' &&
    (settings.voice.defaultLanguage === 'da' || settings.voice.defaultLanguage === 'en') &&
    typeof settings.voice.minimizeWindowsOnVoiceStart === 'boolean' &&
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
    typeof settings.newProjects.defaultBranch === 'string';
}

const credentialNames: Record<string, string> = {
  'codex-login': 'Codex login',
  'copilot-token': 'Copilot token (jarvis-copilot)',
  'github-app': 'GitHub App',
};
/** Credentials the backend can renew on request. */
const renewableCredentials = new Set(['codex-login']);
const credentialStatusLabels: Record<CredentialStatus['status'], string> = {
  ok: 'OK',
  renew_soon: 'Renew soon',
  failed: 'Action needed',
  unknown: 'Unknown',
};

function formatCredentialDate(value: string | null): string {
  if (value === null) return 'Not recorded';
  return `${formatDateTime(value, { timeZone: 'UTC' })} UTC`;
}

function changedSettings(before: Settings, after: Settings): SettingsPatch {
  const patch: Record<string, Record<string, unknown>> = {};
  const areas = after as unknown as Record<string, Record<string, unknown> | undefined>;
  const previous = before as unknown as Record<string, Record<string, unknown> | undefined>;
  for (const area of Object.keys(areas)) {
    const next = areas[area];
    if (!next || typeof next !== 'object') continue;
    for (const key of Object.keys(next)) {
      if (previous[area]?.[key] !== next[key]) (patch[area] ??= {})[key] = next[key];
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
  if (response.status === 503) throw new Error('Settings could not be loaded. Try again.');
  if (!response.ok) throw new Error(`Jarvis could not ${method === 'GET' ? 'load' : 'save'} settings (HTTP ${response.status}).`);
  let result: unknown;
  try { result = await response.json(); } catch { throw new Error('Jarvis returned invalid settings. Try again.'); }
  if (!isSettingsResponse(result)) throw new Error('Jarvis returned invalid settings. Try again.');
  return result;
}

function SelectField({
  id, label, value, options, onChange, disabled = false, form, help,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  form?: string;
  help?: string;
}) {
  return (
    <div className="settings-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} form={form}
        aria-describedby={help ? `${id}-help` : undefined} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{optionLabels[option] ?? option}</option>)}
      </select>
      {help && <p className="settings-explanation" id={`${id}-help`}>{help}</p>}
    </div>
  );
}

export function SettingsPage({ backendUrl, getAccessToken, presence, notifications, projects, renderProjects, nutrition, healthUpload, proactive, memory, onBack }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  /** Presence mode and instructions per mode, shown before the saved settings. */
  presence?: ReactNode;
  /** Optional push opt-in controls, present only when the client feature gate is on. */
  notifications?: ReactNode;
  /** Project management, rendered with this page's new-project defaults disclosure. */
  projects?: ReactNode;
  renderProjects?: (projectDefaults: ReactNode) => ReactNode;
  /** Daily nutrition targets, saved on their own; only supplied while Daily is on. */
  nutrition?: ReactNode;
  /** Health upload credential management, supplied only while the Daily area is enabled. */
  healthUpload?: ReactNode;
  /** Proactive settings, supplied only while the independent web feature gate is on. */
  proactive?: ReactNode;
  /** What Jarvis remembers: browse, correct and forget. */
  memory?: ReactNode;
  /** Leaves Settings for the previous page (or Jarvis when Settings was opened directly). */
  onBack?: () => void;
}) {
  const themePreference = useThemePreference();
  const [state, setState] = useState<LoadState>(backendUrl ? 'loading' : 'error');
  const [savedSettings, setSavedSettings] = useState<Settings | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [options, setOptions] = useState<SettingsOptions | null>(null);
  const [credentials, setCredentials] = useState<CredentialStatus[]>([]);
  const [saving, setSaving] = useState(false);
  const [resettingPersonality, setResettingPersonality] = useState(false);
  const [projectDefaultsNotice, setProjectDefaultsNotice] = useState<{
    kind: 'saving' | 'saved' | 'error';
    message: string;
  } | null>(null);
  const [message, setMessage] = useState('');
  const [personalityResetMessage, setPersonalityResetMessage] = useState('');
  const [error, setError] = useState(backendUrl ? '' : 'Settings unavailable.');
  const hashId = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
  const healthUploadAnchor = hashId === 'health-upload';

  const load = useCallback(async () => {
    if (!backendUrl) {
      setError('Settings unavailable.');
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
      cacheVoiceWorkspacePreference(result.settings.voice.minimizeWindowsOnVoiceStart);
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
      cacheVoiceWorkspacePreference(result.settings.voice.minimizeWindowsOnVoiceStart);
      setState('ready');
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : 'Settings could not be loaded. Try again.');
      setState('error');
    });
    return () => { active = false; };
  }, [backendUrl, getAccessToken]);

  useEffect(() => {
    if (state !== 'ready' || !settingsDeepLinkIds.has(hashId)) return;
    const reducedMotion = document.documentElement.dataset.motion === 'reduced' ||
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    return revealWhenReady(() => document.getElementById(hashId), reducedMotion);
  }, [hashId, state]);

  const update = <Area extends keyof Settings, Key extends keyof Settings[Area]>(
    area: Area,
    key: Key,
    value: Settings[Area][Key],
  ) => {
    setSettings((current) => current ? ({
      ...current,
      [area]: { ...current[area], [key]: value },
    }) : current);
    if (area === 'personality') setPersonalityResetMessage('');
    if (area === 'newProjects') setProjectDefaultsNotice(null);
    setMessage('');
  };

  // Optional areas (roles, research, memory, timeouts) only exist on newer backends, so they update separately.
  const updateArea = (area: 'roles' | 'research' | 'memory' | 'timeouts' | 'decisions', key: string, value: unknown) => {
    setSettings((current) => current && current[area] ? ({ ...current, [area]: { ...current[area], [key]: value } }) : current);
    setMessage('');
  };

  // Manual credential renewal (P9-19): the backend renews Codex today; the card reports success, busy or failure.
  const wakeStatus = useWakeStatus();
  const [renewals, setRenewals] = useState<Record<string, { busy: boolean; message: string; tone: 'ok' | 'error' }>>({});
  const renewCredential = async (name: string) => {
    if (!backendUrl) return;
    setRenewals((current) => ({ ...current, [name]: { busy: true, message: '', tone: 'ok' } }));
    try {
      const response = await backendFetch(`${backendUrl}/settings/credentials/${encodeURIComponent(name)}/renew`, {
        method: 'POST',
        headers: { Authorization: `${['Bear', 'er'].join('')} ${await getAccessToken()}` },
      });
      const body = await response.json().catch(() => null) as { error?: unknown; credential?: unknown } | null;
      const updated = body && isObject(body.credential) && body.credential.name === name ? body.credential as unknown as CredentialStatus : null;
      if (updated) setCredentials((current) => current.map((credential) => credential.name === name ? updated : credential));
      const message = response.ok ? 'Renewed.'
        : response.status === 409 ? 'Codex is busy with a task. Try again when it finishes.'
          : typeof body?.error === 'string' ? `${body.error}.` : `Renewal failed (HTTP ${response.status}).`;
      setRenewals((current) => ({ ...current, [name]: { busy: false, message, tone: response.ok ? 'ok' : 'error' } }));
    } catch {
      setRenewals((current) => ({ ...current, [name]: { busy: false, message: 'Jarvis could not be reached. Try again.', tone: 'error' } }));
    }
  };

  const resetPersonality = async () => {

    if (!settings || !savedSettings || !backendUrl || saving || personalityIsDefault) return;
    setSaving(true);
    setResettingPersonality(true);
    setError('');
    setMessage('');
    setPersonalityResetMessage('');
    try {
      const result = await requestSettings(backendUrl, getAccessToken, 'PATCH', { personality: defaultPersonality });
      setSavedSettings(result.settings);
      setSettings((current) => current ? ({ ...current, personality: { ...result.settings.personality } }) : current);
      setOptions(result.options);
      setPersonalityResetMessage('Reset');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Personality could not be reset. Try again.');
    } finally {
      setSaving(false);
      setResettingPersonality(false);
    }
  };

  const saveSettings = async () => {
    if (!settings || !savedSettings || !backendUrl || saving) return;
    const patch = changedSettings(savedSettings, settings);
    if (Object.keys(patch).length === 0) return;
    const savingProjectDefaults = !!patch.newProjects;
    setSaving(true);
    if (savingProjectDefaults) setProjectDefaultsNotice({ kind: 'saving', message: 'Saving project defaults…' });
    setError('');
    setMessage('');
    try {
      const result = await requestSettings(backendUrl, getAccessToken, 'PATCH', patch);
      setSavedSettings(result.settings);
      setSettings(result.settings);
      setOptions(result.options);
      cacheVoiceWorkspacePreference(result.settings.voice.minimizeWindowsOnVoiceStart);
      setPersonalityResetMessage('');
      setMessage('Saved');
      if (savingProjectDefaults) setProjectDefaultsNotice({ kind: 'saved', message: 'Project defaults saved.' });
    } catch (cause) {
      const saveError = cause instanceof Error ? cause.message : 'Settings could not be saved. Try again.';
      setError(saveError);
      if (savingProjectDefaults) setProjectDefaultsNotice({ kind: 'error', message: saveError });
    } finally {
      setSaving(false);
    }
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void saveSettings();
  };

  const dirty = settings !== null && savedSettings !== null &&
    Object.keys(changedSettings(savedSettings, settings)).length > 0;
  const globalLimitsValid = settings !== null &&
    (settings.global.maxCheckAttempts === undefined || (Number.isInteger(settings.global.maxCheckAttempts) && settings.global.maxCheckAttempts >= 0 && settings.global.maxCheckAttempts <= 10)) &&
    (settings.global.visionDailyBudgetUsd === undefined || (Number.isFinite(settings.global.visionDailyBudgetUsd) && settings.global.visionDailyBudgetUsd >= 0 && settings.global.visionDailyBudgetUsd <= 100));
  const maxTasksValid = settings !== null && Number.isSafeInteger(settings.global.maxParallelTasks) &&
    settings.global.maxParallelTasks >= 1 && settings.global.maxParallelTasks <= 100;
  const newProjectMaxTasksValid = settings !== null && Number.isSafeInteger(settings.newProjects.maxParallelTasks) &&
    settings.newProjects.maxParallelTasks >= 1 && settings.newProjects.maxParallelTasks <= 100;
  const personalityInstructionsValid = settings !== null &&
    settings.personality.customInstructions.length <= 2_000 &&
    !hasUnsupportedControlCharacters(settings.personality.customInstructions);
  // Role-based models replace the older per-area model menus when the backend provides them.
  const roleModels = settings && options && isRoleSettings(settings.roles) && isRoleOptions(options.roles) ? options.roles : null;
  const hasVoiceTuning = settings !== null && typeof settings.voice.serverVadThreshold === 'number';
  const problems = settings ? advancedProblems(settings) : {};
  const advancedValid = Object.keys(problems).length === 0;
  const personalityIsDefault = settings !== null &&
    settings.personality.tone === defaultPersonality.tone &&
    settings.personality.responseStyle === defaultPersonality.responseStyle &&
    settings.personality.customInstructions === defaultPersonality.customInstructions;
  const projectDefaultsDirty = settings !== null && savedSettings !== null &&
    Object.keys(changedSettings(savedSettings, settings)).includes('newProjects');
  const saveDisabled = !dirty || !advancedValid || !globalLimitsValid || !maxTasksValid ||
    !newProjectMaxTasksValid || !personalityInstructionsValid || saving;
  const projectDefaultsDisabledReason = !newProjectMaxTasksValid
    ? 'Parallel tasks must be 1–100.'
    : !advancedValid || !globalLimitsValid || !maxTasksValid || !personalityInstructionsValid
      ? 'Fix the invalid fields to save.'
      : '';
  const projectDefaults = state === 'loading' ? (
    <CollapsibleSection storageKey="settings.projects.defaults" headingId="project-defaults-heading" title="Defaults for new projects">
      <StateMessage variant="loading" message="Loading project defaults" />
    </CollapsibleSection>
  ) : state === 'error' ? (
    <CollapsibleSection storageKey="settings.projects.defaults" headingId="project-defaults-heading" title="Defaults for new projects">
      <StateMessage variant="error" className="settings-feedback"
        message={backendUrl ? error : 'Project defaults unavailable'}
        actionLabel={backendUrl ? 'Retry settings' : undefined} onAction={backendUrl ? () => { void load(); } : undefined} />
    </CollapsibleSection>
  ) : settings && options ? (
    <CollapsibleSection storageKey="settings.projects.defaults" headingId="project-defaults-heading" title="Defaults for new projects">
      <div className="settings-grid">
        <div className="settings-field">
          <label htmlFor="new-project-owner">Owner</label>
          <input id="new-project-owner" form="settings-form" maxLength={39} value={settings.newProjects.owner} disabled={saving}
            onChange={(event) => update('newProjects', 'owner', event.target.value)} />
        </div>
        <SelectField id="new-project-visibility" label="Visibility" value={settings.newProjects.visibility}
          options={options.projectVisibilities} disabled={saving} form="settings-form"
          onChange={(value) => update('newProjects', 'visibility', value as 'private' | 'public')} />
        <div className="settings-field">
          <label htmlFor="new-project-templates">Templates repository (owner/name)</label>
          <input id="new-project-templates" form="settings-form" maxLength={140} value={settings.newProjects.templatesRepository} disabled={saving}
            onChange={(event) => update('newProjects', 'templatesRepository', event.target.value)} />
        </div>
        <SelectField id="new-project-agent" label="Default agent" value={settings.newProjects.defaultAgent}
          options={options.projectAgents} disabled={saving} form="settings-form"
          onChange={(value) => update('newProjects', 'defaultAgent', value as 'codex' | 'copilot')} />
        <SelectField id="new-project-policy" label="Policy" value={settings.newProjects.policy}
          options={options.projectPolicies} disabled={saving} form="settings-form"
          onChange={(value) => update('newProjects', 'policy', value as Settings['newProjects']['policy'])} />
        <div className="settings-field settings-number-field">
          <label htmlFor="new-project-max-tasks">New project maximum parallel tasks</label>
          <input id="new-project-max-tasks" form="settings-form" type="number" min="1" max="100" step="1"
            value={settings.newProjects.maxParallelTasks} disabled={saving}
            onChange={(event) => update('newProjects', 'maxParallelTasks', Number(event.target.value))} />
        </div>
        <div className="settings-field">
          <label htmlFor="new-project-branch">Default branch</label>
          <input id="new-project-branch" form="settings-form" maxLength={255} value={settings.newProjects.defaultBranch} disabled={saving}
            onChange={(event) => update('newProjects', 'defaultBranch', event.target.value)} />
        </div>
      </div>
      {projectDefaultsNotice && (
        <p className="settings-feedback" role={projectDefaultsNotice.kind === 'error' ? 'alert' : 'status'}>
          {projectDefaultsNotice.message}
        </p>
      )}
      {projectDefaultsDirty && !projectDefaultsNotice && (
        <p className="settings-feedback" role="status">Unsaved changes</p>
      )}
      {(projectDefaultsDirty || projectDefaultsNotice?.kind === 'error') && (
        <>
          {projectDefaultsDisabledReason && <p className="settings-explanation">{projectDefaultsDisabledReason}</p>}
          <div className="settings-actions">
            <button className="secondary-button" type="submit" form="settings-form" disabled={saveDisabled}>
              {projectDefaultsNotice?.kind === 'error' ? 'Retry save' : saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </>
      )}
    </CollapsibleSection>
  ) : null;

  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <header className="settings-header">
        {onBack && (
          <button className="settings-back" type="button" onClick={onBack}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            <span>Back</span>
          </button>
        )}
        <h1 id="settings-heading">Settings</h1>
      </header>
      {presence}
      {notifications}
      {state === 'loading' && <StateMessage variant="loading" message="Loading settings" />}
      {state === 'error' && (
        <StateMessage variant="error" className="settings-feedback" message={error}
          actionLabel={backendUrl ? 'Retry' : undefined} onAction={backendUrl ? () => { void load(); } : undefined} />
      )}
      {state === 'ready' && settings && options && (
        <form id="settings-form" onSubmit={(event) => { void save(event); }}>
          <CollapsibleSection storageKey="settings.appearance" headingId="appearance-settings-heading" title="Appearance" summary={<>{themePreference.theme === 'system' ? 'System theme' : themePreference.theme === 'dark' ? 'Dark theme' : 'Light theme'}</>}>
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
              <label className="choice" htmlFor="theme-system">
                <input id="theme-system" name="theme" type="radio" value="system"
                  checked={themePreference.theme === 'system'}
                  onChange={() => { void themePreference.saveTheme('system'); }} />
                System
              </label>
            </fieldset>
            {themePreference.state === 'loading' && <StateMessage variant="loading" message="Loading saved theme" />}
            {themePreference.state === 'error' && (
              <StateMessage variant="error" className="settings-feedback" message={themePreference.error}
                actionLabel="Retry theme" onAction={themePreference.retry} />
            )}
            {themePreference.state === 'ready' && themePreference.saving &&
              <p className="settings-feedback" role="status">Saving theme…</p>}
            {themePreference.state === 'ready' && themePreference.error &&
              <p className="settings-feedback" role="alert">{themePreference.error}</p>}
            {themePreference.state === 'ready' && !themePreference.error && themePreference.message &&
              <p className="settings-feedback" role="status">{themePreference.message}</p>}
            <AppearanceDetails />
          </CollapsibleSection>

          {!roleModels && (
          <CollapsibleSection storageKey="settings.jarvis" headingId="jarvis-settings-heading" title="Jarvis" summary={<>{settings.jarvis.model}</>}>
            <div className="settings-grid">
              <SelectField id="jarvis-model" label="Chat and Danish voice model" value={settings.jarvis.model}
                options={options.jarvisModels} disabled={saving}
                onChange={(value) => update('jarvis', 'model', value)} />
              <SelectField id="jarvis-reasoning" label="Reasoning effort" value={settings.jarvis.reasoning}
                options={options.reasoningEfforts} disabled={saving}
                onChange={(value) => update('jarvis', 'reasoning', value)} />
            </div>
          </CollapsibleSection>
          )}
          {roleModels && settings.roles && <ModelsSection roles={settings.roles} options={roleModels} disabled={saving}
            backendUrl={backendUrl} getAccessToken={getAccessToken}
            onChange={(role: ModelRole, value) => updateArea('roles', role, value)} />}

          {settings.decisions && options.decisionProviders?.includes(settings.decisions.provider) && (
            <CollapsibleSection storageKey="settings.decisions" headingId="decisions-settings-heading" title="Decisions"
              summary={<>{optionLabels[settings.decisions.provider] ?? settings.decisions.provider}</>}>
              <div className="settings-grid">
                <SelectField id="decision-provider" label="Decision service" value={settings.decisions.provider}
                  options={options.decisionProviders} disabled={saving}
                  onChange={(value) => updateArea('decisions', 'provider', value)} />
              </div>
            </CollapsibleSection>
          )}

          <CollapsibleSection storageKey="settings.personality" headingId="personality-settings-heading" title="Jarvis Personality">
            <div className="settings-grid">
              <SelectField id="personality-tone" label="Tone" value={settings.personality.tone}
                options={options.personalityTones} disabled={saving}
                onChange={(value) => update('personality', 'tone', value as Settings['personality']['tone'])} />
              <SelectField id="personality-response-style" label="Response style" value={settings.personality.responseStyle}
                options={options.personalityResponseStyles} disabled={saving}
                onChange={(value) => update('personality', 'responseStyle', value as Settings['personality']['responseStyle'])} />
              <div className="settings-field">
                <label htmlFor="personality-instructions">Custom instructions</label>
                <textarea id="personality-instructions" rows={5} maxLength={2_000}
                  value={settings.personality.customInstructions} disabled={saving}
                  aria-describedby={`personality-instructions-help${personalityInstructionsValid ? '' : ' personality-instructions-error'}`}
                  aria-invalid={!personalityInstructionsValid}
                  onChange={(event) => update('personality', 'customInstructions', event.target.value)} />
                <p className="settings-explanation" id="personality-instructions-help">
                  {settings.personality.customInstructions.length} / 2,000 characters
                </p>
                {!personalityInstructionsValid && (
                  <p className="settings-validation-error" id="personality-instructions-error" role="alert">
                    Remove control characters other than line breaks, tabs, and spaces.
                  </p>
                )}
              </div>
            </div>
            <p className="visually-hidden" id="personality-reset-help">
              {saving ? 'Personality is saving.' : personalityIsDefault ? 'The default personality is already selected.' : 'Reset the personality to the default.'}
            </p>
            <div className="settings-actions">
              <button className="secondary-button" type="button" disabled={saving || personalityIsDefault}
                aria-describedby="personality-reset-help"
                onClick={() => { void resetPersonality(); }}>Reset personality</button>
            </div>
            {(resettingPersonality || personalityResetMessage) && (
              <p className="settings-explanation" role="status">
                {resettingPersonality ? 'Resetting personality…' : personalityResetMessage}
              </p>
            )}
          </CollapsibleSection>

          <CollapsibleSection storageKey="settings.voice" headingId="voice-settings-heading" title="Voice">
            <div className="settings-grid">
              {!roleModels && <>
              <SelectField id="speech-model" label="Speech-to-text model" value={settings.voice.speechToTextModel}
                options={options.speechToTextModels} disabled={saving}
                onChange={(value) => update('voice', 'speechToTextModel', value)} />
              <SelectField id="english-voice-model" label="English speech-to-speech model" value={settings.voice.englishModel}
                options={options.englishModels} disabled={saving}
                onChange={(value) => update('voice', 'englishModel', value)} />
              </>}
              <SelectField id="english-voice" label="English voice" value={settings.voice.englishVoice}
                options={options.englishVoices} disabled={saving}
                onChange={(value) => update('voice', 'englishVoice', value)} />
              <div className="settings-field">
                <label htmlFor="danish-voice">Danish voice</label>
                <input id="danish-voice" value={optionLabels['da-DK-JeppeNeural']} readOnly />
              </div>
              <SelectField id="default-language" label="Default language" value={settings.voice.defaultLanguage}
                options={options.languages} disabled={saving}
                onChange={(value) => update('voice', 'defaultLanguage', value as 'da' | 'en')} />
            </div>
            <label className="choice" htmlFor="minimize-windows-on-voice-start">
              <input
                id="minimize-windows-on-voice-start"
                type="checkbox"
                checked={settings.voice.minimizeWindowsOnVoiceStart}
                disabled={saving}
                onChange={(event) => update('voice', 'minimizeWindowsOnVoiceStart', event.target.checked)}
              />
              Minimise all windows when starting voice
            </label>
            <p className="wake-status" role="status" data-outcome={wakeStatus?.outcome ?? 'none'}>
              <strong>Wake word</strong>
              <span>{wakeStatus
                ? `Last heard ${formatTimeOnly(wakeStatus.at)}. ${wakeStatus.message}`
                : 'Not heard'}</span>
            </p>
            {hasVoiceTuning && <VoiceTuningFields voice={settings.voice as VoiceTuningSettings} problems={problems} disabled={saving}
              onChange={(key, value) => update('voice', key, value as never)} />}
          </CollapsibleSection>

          {settings.research && <ResearchSection research={settings.research} problems={problems} disabled={saving}
            onChange={(key, value) => updateArea('research', key, value)} />}
          {settings.memory
            ? <RetrievalSection memory={settings.memory} problems={problems} disabled={saving}
              onChange={(key, value) => updateArea('memory', key, value)}>{memory}</RetrievalSection>
            : memory && <CollapsibleSection storageKey="settings.memory" id="memory" headingId="memory-settings-heading" title="Memory">{memory}</CollapsibleSection>}
          {settings.timeouts && <TimeoutsSection timeouts={settings.timeouts} problems={problems} disabled={saving}
            onChange={(key, value) => updateArea('timeouts', key, value)} />}

          {!roleModels && (
          <CollapsibleSection storageKey="settings.coding" headingId="coding-settings-heading" title="Coding agents">
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
          </CollapsibleSection>
          )}

          <CollapsibleSection storageKey="settings.global" headingId="global-settings-heading" title="Limits" summary={<>{`Up to ${settings.global.maxParallelTasks} parallel tasks`}</>}>
            <div className="settings-grid">
              <div className="settings-field settings-number-field">
                <label htmlFor="max-parallel-tasks">Maximum parallel tasks</label>
                <input id="max-parallel-tasks" type="number" min="1" max="100" step="1"
                  value={settings.global.maxParallelTasks} disabled={saving}
                  onChange={(event) => update('global', 'maxParallelTasks', Number(event.target.value))} />
              </div>
              <div className="settings-field settings-number-field">
                <label htmlFor="screen-share-daily-frame-cap">Daily screen inspection limit</label>
                <input id="screen-share-daily-frame-cap" type="number" min="1" max="300" step="1"
                  value={settings.global.screenShareDailyFrameCap} disabled={saving}
                  onChange={(event) => update('global', 'screenShareDailyFrameCap', Number(event.target.value))} />
                <p className="settings-explanation">1–300 frames per UTC day</p>
              </div>
              {typeof settings.global.maxCheckAttempts === 'number' && (
                <div className="settings-field settings-number-field">
                  <label htmlFor="max-check-attempts">Check repair attempts</label>
                  <input id="max-check-attempts" type="number" min="0" max="10" step="1"
                    value={settings.global.maxCheckAttempts} disabled={saving}
                    onChange={(event) => update('global', 'maxCheckAttempts', Number(event.target.value))} />
                </div>
              )}
              {typeof settings.global.visionDailyBudgetUsd === 'number' && (
                <div className="settings-field settings-number-field">
                  <label htmlFor="vision-daily-budget">Daily watch budget (USD)</label>
                  <input id="vision-daily-budget" type="number" min="0" max="100" step="0.1"
                    value={settings.global.visionDailyBudgetUsd} disabled={saving}
                    onChange={(event) => update('global', 'visionDailyBudgetUsd', event.target.valueAsNumber)} />
                </div>
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection storageKey="settings.credentials" headingId="credentials-heading" title="Credentials">
            {credentials.length === 0
              ? <p role="status">No credentials</p>
              : (
                <ul className="credential-list">
                  {credentials.map((credential) => {
                    const renewal = renewals[credential.name];
                    return (
                      <li className="credential-card" key={credential.name} data-status={credential.status}>
                        <span className="credential-head">
                          <strong>{credentialNames[credential.name] ?? credential.name}</strong>
                          <span className="credential-status">Status: {credentialStatusLabels[credential.status]}</span>
                        </span>
                        <span>Expires: {formatCredentialDate(credential.expiresAt)}</span>
                        <span>Last renewed: {formatCredentialDate(credential.lastRenewedAt)}</span>
                        {renewableCredentials.has(credential.name) && (
                          <span className="credential-actions">
                            <button className="secondary-button" type="button" disabled={renewal?.busy || !backendUrl}
                              onClick={() => { void renewCredential(credential.name); }}>
                              {renewal?.busy ? 'Renewing…' : 'Renew'}
                            </button>
                            {renewal?.message && (
                              <span className="credential-result" role={renewal.tone === 'error' ? 'alert' : 'status'} data-tone={renewal.tone}>{renewal.message}</span>
                            )}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
          </CollapsibleSection>

        </form>
      )}
      {renderProjects ? renderProjects(projectDefaults) : projects}
      {nutrition}
      {healthUpload && <CollapsibleSection storageKey="settings.health-upload" id="health-upload" headingId="health-upload-heading"
        title="Health upload" initiallyOpen={healthUploadAnchor} persist={!healthUploadAnchor}>{healthUpload}</CollapsibleSection>}
      {proactive}
      {state !== 'ready' && memory && <CollapsibleSection storageKey="settings.memory" id="memory" headingId="memory-settings-heading" title="Memory">{memory}</CollapsibleSection>}
      {backendUrl && <TaskRecipesSettings key={backendUrl} backendUrl={backendUrl} getAccessToken={getAccessToken} />}
      {state === 'ready' && settings && options && (
      <div className="settings-save">
        <p className="settings-feedback" role={error ? 'alert' : 'status'} aria-live="polite">
          {error || message}
        </p>
        <button className="primary-button" type="submit" form="settings-form" disabled={saveDisabled} aria-busy={(saving && !resettingPersonality) || undefined} aria-label={saving && !resettingPersonality ? 'Saving…' : undefined}>
          <span className="button-label">Save settings</span>
          {saving && !resettingPersonality && <span className="button-loading-indicator" aria-hidden="true"><Loader variant="inline" announce={false} label="Saving settings…" /></span>}
        </button>
      </div>
      )}
    </section>
  );
}
