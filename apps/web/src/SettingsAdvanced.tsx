import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useThemePreference } from './theme-preference-context';
import type { AppearanceChange } from './theme-preference-context';
import { isModelCatalogue } from '@jarvis/contracts';
import { backendFetch } from './backend-request';
import { CollapsibleSection } from './CollapsibleSection';
import {
  bounds, capabilityLabels, effortLabels, effortsFor, modelRoles, researchDepths, roleLabels,
  type MemorySettings, type ModelCatalogue, type ModelRole, type ResearchSettings, type RoleOptions, type RoleSettings,
  type TimeoutSettings, type VoiceTuningSettings,
} from './settings-advanced-data';

type Problems = Record<string, string>;

function NumberField({ id, label, value, unit, min, max, step = 1, problem, disabled, onChange }: {
  id: string; label: string; value: number; unit?: string; min: number; max: number; step?: number;
  problem?: string | undefined; disabled: boolean; onChange: (value: number) => void;
}) {
  return (
    <div className="settings-field advanced-field">
      <label htmlFor={id}>{label}</label>
      <span className="advanced-number">
        <input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} disabled={disabled}
          value={Number.isFinite(value) ? value : ''} aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
          onChange={(event) => onChange(event.target.value === '' ? Number.NaN : event.target.valueAsNumber)} />
        {unit && <span className="advanced-unit">{unit}</span>}
      </span>
      {problem && <p className="field-error" id={`${id}-problem`}>{problem}</p>}
    </div>
  );
}

/** A 0–1 value as a slider with its number beside it. */
function RangeField({ id, label, value, min, max, step, disabled, onChange, low, high, format }: {
  id: string; label: string; value: number; min: number; max: number; step: number; disabled: boolean;
  onChange: (value: number) => void; low: string; high: string; format?: (value: number) => string;
}) {
  return (
    <div className="settings-field advanced-field advanced-range">
      <label htmlFor={id}>{label}<output htmlFor={id}>{Number.isFinite(value) ? (format ? format(value) : value.toFixed(2)) : '—'}</output></label>
      <input id={id} type="range" min={min} max={max} step={step} value={Number.isFinite(value) ? value : min} disabled={disabled}
        onChange={(event) => onChange(event.target.valueAsNumber)} />
      <span className="advanced-range-ends" aria-hidden="true"><span>{low}</span><span>{high}</span></span>
    </div>
  );
}

function Toggle({ id, label, checked, disabled, onChange, hint }: {
  id: string; label: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void; hint?: string;
}) {
  return (
    <label className="advanced-toggle" htmlFor={id}>
      <span><span className="advanced-toggle-label">{label}</span>{hint && <span className="advanced-toggle-hint">{hint}</span>}</span>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

const keepEnterInside = (event: KeyboardEvent) => { if (event.key === 'Enter') event.preventDefault(); };

/** Models per role, with reasoning limited to what each model supports, and the Foundry deployments behind them. */
export function ModelsSection({ roles, options, onChange, disabled, backendUrl, getAccessToken }: {
  roles: RoleSettings; options: Record<ModelRole, RoleOptions>; onChange: (role: ModelRole, value: RoleSettings[ModelRole]) => void;
  disabled: boolean; backendUrl: string | null; getAccessToken: () => Promise<string>;
}) {
  const [catalogue, setCatalogue] = useState<ModelCatalogue | null>(null);
  const [catalogueError, setCatalogueError] = useState('');
  const [reload, setReload] = useState(0);
  const call = useCallback(async (path: string, init?: { method: 'POST' | 'DELETE'; body?: unknown }) => {
    if (!backendUrl) throw new Error('Models are unavailable until the backend is deployed.');
    const token = await getAccessToken();
    return backendFetch(`${backendUrl.replace(/\/+$/u, '')}${path}`, {
      method: init?.method ?? 'GET',
      headers: { Authorization: `${['Bear', 'er'].join('')} ${token}`, Accept: 'application/json',
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      cache: 'no-store',
    });
  }, [backendUrl, getAccessToken]);

  useEffect(() => {
    let active = true;
    call('/models').then(async (response) => {
      const body: unknown = response.ok ? await response.json() : null;
      if (!active) return;
      if (!isModelCatalogue(body)) { setCatalogueError('The model catalogue could not be loaded.'); return; }
      setCatalogue(body);
      setCatalogueError('');
    }).catch(() => { if (active) setCatalogueError('The model catalogue could not be loaded.'); });
    return () => { active = false; };
  }, [call, reload]);

  const capabilitiesFor = (model: string) => catalogue?.deployments.find((deployment) => deployment.model === model || deployment.name === model)?.capabilities ?? [];
  const summary = `${modelRoles.length} roles${catalogue ? ` · ${catalogue.deployments.length} deployments` : ''}`;

  return (
    <CollapsibleSection storageKey="settings.models" headingId="models-settings-heading" title="Models" summary={summary}>
      <p className="settings-explanation">Which model Jarvis uses for each kind of work. Reasoning shows only the levels the chosen model supports.</p>
      <ul className="role-list">
        {modelRoles.map((role) => {
          const current = roles[role];
          const efforts = effortsFor(options, role, current.model);
          const agentRole = role === 'codex' || role === 'copilot';
          const models = options[role].models.includes(current.model) ? options[role].models : [current.model, ...options[role].models];
          return (
            <li key={role} className="role-row">
              <span className="role-name">{roleLabels[role].label}<span className="role-hint">{roleLabels[role].hint}</span></span>
              <span className="role-controls">
                <label className="visually-hidden" htmlFor={`role-${role}-model`}>{roleLabels[role].label} model</label>
                <select id={`role-${role}-model`} value={current.model} disabled={disabled}
                  onChange={(event) => {
                    const model = event.target.value;
                    const allowed = effortsFor(options, role, model);
                    onChange(role, { model, reasoningEffort: (allowed.includes(current.reasoningEffort) ? current.reasoningEffort : allowed[0]) as RoleSettings[ModelRole]['reasoningEffort'] });
                  }}>
                  {models.map((model) => <option key={model} value={model}>{model === 'default' ? 'Provider default' : model}</option>)}
                </select>
                <label className="visually-hidden" htmlFor={`role-${role}-effort`}>{roleLabels[role].label} reasoning</label>
                <select id={`role-${role}-effort`} value={current.reasoningEffort} disabled={disabled || efforts.length < 2}
                  title={efforts.length < 2 ? 'This model has no reasoning levels' : undefined}
                  onChange={(event) => onChange(role, { ...current, reasoningEffort: event.target.value as RoleSettings[ModelRole]['reasoningEffort'] })}>
                  {efforts.map((effort) => <option key={effort} value={effort}>{agentRole && effort === 'none' ? 'Provider default' : effortLabels[effort] ?? effort}</option>)}
                </select>
              </span>
              {capabilitiesFor(current.model).length > 0 && (
                <span className="role-badges" aria-label="Capabilities">
                  {capabilitiesFor(current.model).map((capability) => <span key={capability} className="model-badge">{capabilityLabels[capability] ?? capability}</span>)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <Deployments catalogue={catalogue} error={catalogueError} call={call} onChanged={() => setReload((value) => value + 1)} />
    </CollapsibleSection>
  );
}

function Deployments({ catalogue, error, call, onChanged }: {
  catalogue: ModelCatalogue | null; error: string; onChanged: () => void;
  call: (path: string, init?: { method: 'POST' | 'DELETE'; body?: unknown }) => Promise<Response>;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ model: '', version: '', sku: 'GlobalStandard', capacity: 10 });
  const draftValid = draft.model.trim().length > 0 && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(draft.version) &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(draft.sku) && Number.isInteger(draft.capacity) && draft.capacity >= 1 && draft.capacity <= 100_000;

  const run = async (path: string, init: { method: 'POST' | 'DELETE'; body?: unknown }, pending: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await call(path, init);
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      if (response.status === 202) { setNotice({ text: pending, tone: 'info' }); onChanged(); return true; }
      setNotice({ text: typeof body?.error === 'string' ? body.error : `The change could not be requested (${response.status}).`, tone: 'error' });
      return false;
    } catch {
      setNotice({ text: 'The change could not be requested. Check the connection and try again.', tone: 'error' });
      return false;
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <div className="deployments">
      <div className="deployments-head">
        <h3>Deployments</h3>
        {catalogue?.source === 'fallback' && <span className="model-badge">Offline list</span>}
        <button className="secondary-button" type="button" aria-expanded={adding} onClick={() => setAdding((open) => !open)}>
          {adding ? 'Cancel' : 'Add deployment'}
        </button>
      </div>
      {catalogue?.source === 'fallback' && catalogue.reason && <p className="settings-explanation">{catalogue.reason}</p>}
      {error && <p className="settings-feedback" role="alert">{error}</p>}
      {notice && <p className="settings-feedback" role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
      {adding && (
        <div className="deployment-add" role="group" aria-label="New deployment">
          <div className="settings-field"><label htmlFor="deployment-model">Model</label>
            <input id="deployment-model" value={draft.model} maxLength={128} onKeyDown={keepEnterInside}
              onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="gpt-6-luna" /></div>
          <div className="settings-field"><label htmlFor="deployment-version">Version</label>
            <input id="deployment-version" value={draft.version} maxLength={128} onKeyDown={keepEnterInside}
              onChange={(event) => setDraft({ ...draft, version: event.target.value })} placeholder="2026-09-01" /></div>
          <div className="settings-field"><label htmlFor="deployment-sku">SKU</label>
            <input id="deployment-sku" value={draft.sku} maxLength={64} onKeyDown={keepEnterInside}
              onChange={(event) => setDraft({ ...draft, sku: event.target.value })} /></div>
          <div className="settings-field"><label htmlFor="deployment-capacity">Capacity</label>
            <input id="deployment-capacity" type="number" min={1} max={100000} value={Number.isFinite(draft.capacity) ? draft.capacity : ''}
              onKeyDown={keepEnterInside} onChange={(event) => setDraft({ ...draft, capacity: event.target.valueAsNumber })} /></div>
          <button className="primary-button" type="button" disabled={!draftValid || busy}
            onClick={() => { void run('/models/deployments', { method: 'POST', body: { model: draft.model.trim(), version: draft.version, sku: draft.sku, capacity: draft.capacity } },
              `Requested ${draft.model.trim()}. Approve it in Teams; it appears here once it is deployed.`).then((done) => { if (done) setAdding(false); }); }}>
            Request deployment
          </button>
        </div>
      )}
      {!catalogue && !error && <p className="settings-explanation">Loading deployments…</p>}
      {catalogue && (
        <ul className="deployment-list">
          {catalogue.deployments.map((deployment) => (
            <li key={deployment.name} className="deployment-row">
              <span className="deployment-name">{deployment.name}
                <span className="deployment-meta">{deployment.model === deployment.name ? '' : `${deployment.model} · `}{deployment.sku} · capacity {deployment.capacity}</span>
              </span>
              <span className="role-badges">{deployment.capabilities.map((capability) => <span key={capability} className="model-badge">{capabilityLabels[capability] ?? capability}</span>)}</span>
              {confirming === deployment.name ? (
                <span className="deployment-confirm" role="group" aria-label={`Remove ${deployment.name}`}>
                  <button className="secondary-button danger-button" type="button" disabled={busy}
                    onClick={() => { void run(`/models/deployments/${encodeURIComponent(deployment.name)}`, { method: 'DELETE' },
                      `Removal of ${deployment.name} requested. Approve it in Teams.`); }}>Remove</button>
                  <button className="secondary-button" type="button" onClick={() => setConfirming(null)}>Keep</button>
                </span>
              ) : catalogue.source === 'arm' ? (
                <button className="secondary-button" type="button" aria-label={`Remove ${deployment.name}`} onClick={() => setConfirming(deployment.name)}>Remove</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VoiceTuningFields({ voice, problems, disabled, onChange }: {
  voice: VoiceTuningSettings; problems: Problems; disabled: boolean;
  onChange: <Key extends keyof VoiceTuningSettings>(key: Key, value: VoiceTuningSettings[Key]) => void;
}) {
  return (
    <div className="advanced-group">
      <h3>Listening and replies</h3>
      <RangeField id="voice-vad" label="Speech detection sensitivity" value={voice.serverVadThreshold} min={0} max={1} step={0.05}
        disabled={disabled} onChange={(value) => onChange('serverVadThreshold', value)} low="Hears more" high="Ignores noise" />
      <div className="settings-grid">
        <NumberField id="voice-silence" label="Pause before Jarvis replies" unit="ms" value={voice.silenceDurationMs}
          min={bounds.voice.silenceDurationMs.minimum} max={bounds.voice.silenceDurationMs.maximum}
          problem={problems['voice.silenceDurationMs']} disabled={disabled} onChange={(value) => onChange('silenceDurationMs', value)} />
        <NumberField id="voice-padding" label="Audio kept before speech" unit="ms" value={voice.prefixPaddingMs}
          min={bounds.voice.prefixPaddingMs.minimum} max={bounds.voice.prefixPaddingMs.maximum}
          problem={problems['voice.prefixPaddingMs']} disabled={disabled} onChange={(value) => onChange('prefixPaddingMs', value)} />
        <NumberField id="voice-reply-tokens" label="Longest spoken reply" unit="tokens" value={voice.maxSpokenReplyTokens}
          min={bounds.voice.maxSpokenReplyTokens.minimum} max={bounds.voice.maxSpokenReplyTokens.maximum}
          problem={problems['voice.maxSpokenReplyTokens']} disabled={disabled} onChange={(value) => onChange('maxSpokenReplyTokens', value)} />
      </div>
      <Toggle id="voice-barge-in" label="Interrupt Jarvis by speaking" hint="Jarvis stops talking when you start"
        checked={voice.bargeInEnabled} disabled={disabled} onChange={(value) => onChange('bargeInEnabled', value)} />
    </div>
  );
}

function Section({ storageKey, headingId, title, summary, children }: { storageKey: string; headingId: string; title: string; summary: string; children: ReactNode }) {
  return <CollapsibleSection storageKey={storageKey} headingId={headingId} title={title} summary={summary}>{children}</CollapsibleSection>;
}

const depthLabels: Record<string, string> = { quick: 'Quick', standard: 'Standard', deep: 'Deep' };

export function ResearchSection({ research, problems, disabled, onChange }: {
  research: ResearchSettings; problems: Problems; disabled: boolean;
  onChange: <Key extends keyof ResearchSettings>(key: Key, value: ResearchSettings[Key]) => void;
}) {
  return (
    <Section storageKey="settings.research" headingId="research-settings-heading" title="Research"
      summary={`${depthLabels[research.depth] ?? research.depth} · up to ${research.maxSources} sources`}>
      <div className="advanced-segmented" role="group" aria-label="Research depth">
        {researchDepths.map((depth) => (
          <button key={depth} type="button" aria-pressed={research.depth === depth} disabled={disabled} onClick={() => onChange('depth', depth)}>
            {depthLabels[depth] ?? depth}
          </button>
        ))}
      </div>
      <div className="settings-grid">
        <NumberField id="research-sources" label="Most sources" value={research.maxSources}
          min={bounds.research.maxSources.minimum} max={bounds.research.maxSources.maximum}
          problem={problems['research.maxSources']} disabled={disabled} onChange={(value) => onChange('maxSources', value)} />
        <NumberField id="research-timeout" label="Time limit" unit="s" value={research.timeoutSeconds}
          min={bounds.research.timeoutSeconds.minimum} max={bounds.research.timeoutSeconds.maximum}
          problem={problems['research.timeoutSeconds']} disabled={disabled} onChange={(value) => onChange('timeoutSeconds', value)} />
      </div>
    </Section>
  );
}

export function RetrievalSection({ memory, problems, disabled, onChange }: {
  memory: MemorySettings; problems: Problems; disabled: boolean;
  onChange: <Key extends keyof MemorySettings>(key: Key, value: MemorySettings[Key]) => void;
}) {
  return (
    <Section storageKey="settings.retrieval" headingId="retrieval-settings-heading" title="Memory and retrieval"
      summary={`Top ${memory.searchTopK} · ${memory.automaticCapture ? 'remembers automatically' : 'remembers on request'}`}>
      <RangeField id="memory-similarity" label="How close a memory must match" value={memory.similarityThreshold} min={0} max={1} step={0.01}
        disabled={disabled} onChange={(value) => onChange('similarityThreshold', value)} low="Loose" high="Strict" />
      <RangeField id="memory-graph-similarity" label="Knowledge graph links" value={memory.graphTextSimilarityThreshold} min={0} max={1} step={0.01}
        disabled={disabled} onChange={(value) => onChange('graphTextSimilarityThreshold', value)} low="More links" high="Fewer links" />
      <div className="settings-grid">
        <NumberField id="memory-top-k" label="Memories per answer" value={memory.searchTopK}
          min={bounds.memory.searchTopK.minimum} max={bounds.memory.searchTopK.maximum}
          problem={problems['memory.searchTopK']} disabled={disabled} onChange={(value) => onChange('searchTopK', value)} />
      </div>
      <Toggle id="memory-capture" label="Remember things automatically" hint="Jarvis saves useful facts from conversations"
        checked={memory.automaticCapture} disabled={disabled} onChange={(value) => onChange('automaticCapture', value)} />
    </Section>
  );
}

export function TimeoutsSection({ timeouts, problems, disabled, onChange }: {
  timeouts: TimeoutSettings; problems: Problems; disabled: boolean;
  onChange: <Key extends keyof TimeoutSettings>(key: Key, value: TimeoutSettings[Key]) => void;
}) {
  return (
    <Section storageKey="settings.timeouts" headingId="timeouts-settings-heading" title="Timeouts"
      summary={`Tools ${timeouts.toolTimeoutSeconds} s · long tools ${timeouts.longToolTimeoutSeconds} s`}>
      <div className="settings-grid">
        <NumberField id="timeout-tool" label="Tools" unit="s" value={timeouts.toolTimeoutSeconds}
          min={bounds.timeouts.toolTimeoutSeconds.minimum} max={bounds.timeouts.toolTimeoutSeconds.maximum}
          problem={problems['timeouts.toolTimeoutSeconds']} disabled={disabled} onChange={(value) => onChange('toolTimeoutSeconds', value)} />
        <NumberField id="timeout-long-tool" label="Long tools (research, images)" unit="s" value={timeouts.longToolTimeoutSeconds}
          min={bounds.timeouts.longToolTimeoutSeconds.minimum} max={bounds.timeouts.longToolTimeoutSeconds.maximum}
          problem={problems['timeouts.longToolTimeoutSeconds']} disabled={disabled} onChange={(value) => onChange('longToolTimeoutSeconds', value)} />
        <NumberField id="timeout-backend" label="Backend requests" unit="s" value={timeouts.backendHttpTimeoutSeconds}
          min={bounds.timeouts.backendHttpTimeoutSeconds.minimum} max={bounds.timeouts.backendHttpTimeoutSeconds.maximum}
          problem={problems['timeouts.backendHttpTimeoutSeconds']} disabled={disabled} onChange={(value) => onChange('backendHttpTimeoutSeconds', value)} />
      </div>
    </Section>
  );
}

function Choice<T extends string>({ label, value, options, disabled, onChange }: {
  label: string; value: T | undefined; options: readonly { value: T; label: string }[]; disabled: boolean; onChange: (value: T) => void;
}) {
  return (
    <div className="settings-field advanced-field">
      <span className="advanced-choice-label" id={`${label}-label`}>{label}</span>
      <div className="advanced-segmented" role="group" aria-labelledby={`${label}-label`}>
        {options.map((option) => (
          <button key={option.value} type="button" aria-pressed={value === option.value} disabled={disabled} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Appearance details (P9-09): motion, density, background, corners, glow and colours. Each change applies at once and
 * saves; sliders and colour pickers wait until Dan pauses. Colours can return to Jarvis's own cyan and amber.
 */
export function AppearanceDetails() {
  const preference = useThemePreference();
  const appearance = preference.appearance;
  const disabled = preference.state !== 'ready' || !preference.saveAppearance;
  const [draft, setDraft] = useState<{ radius?: number; glow?: number; accent?: string; 'accent-secondary'?: string; 'surface-tint'?: string }>({});
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const save = (change: AppearanceChange) => { void preference.saveAppearance?.(change); };
  const later = (change: Partial<typeof draft>) => {
    setDraft((current) => ({ ...current, ...change }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void preference.saveAppearance?.(change).finally(() => setDraft((current) => {
        const next = { ...current };
        for (const key of Object.keys(change)) delete next[key as keyof typeof next];
        return next;
      }));
    }, 450);
  };
  const radius = draft.radius ?? appearance.radius ?? 18;
  const glow = draft.glow ?? appearance.glow ?? 1;
  const hasCustomColours = Boolean(appearance.accent || appearance['accent-secondary'] || appearance['surface-tint']);
  const colour = (key: 'accent' | 'accent-secondary' | 'surface-tint', label: string, fallback: string) => (
    <label className="advanced-colour" htmlFor={`appearance-${key}`}>
      <input id={`appearance-${key}`} type="color" value={draft[key] ?? appearance[key] ?? fallback} disabled={disabled}
        onChange={(event) => later({ [key]: event.target.value })} />
      <span>{label}<span className="advanced-toggle-hint">{appearance[key] ? appearance[key] : 'Jarvis default'}</span></span>
    </label>
  );
  return (
    <div className="advanced-group">
      <h3>Look and feel</h3>
      <Choice label="Motion" value={appearance.motion ?? 'full'} disabled={disabled} onChange={(motion) => save({ motion })}
        options={[{ value: 'full', label: 'Full' }, { value: 'calm', label: 'Calm' }, { value: 'reduced', label: 'Reduced' }]} />
      <Choice label="Density" value={appearance.density ?? 'comfortable'} disabled={disabled} onChange={(density) => save({ density })}
        options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
      <Choice label="Background" value={appearance.background ?? 'living-aurora'} disabled={disabled} onChange={(background) => save({ background })}
        options={[{ value: 'living-aurora', label: 'Living aurora' }, { value: 'daylight-studio', label: 'Daylight studio' }]} />
      <RangeField id="appearance-radius" label="Corner roundness" value={radius} min={0} max={24} step={1} disabled={disabled}
        onChange={(value) => later({ radius: value })} low="Square" high="Round" format={(value) => `${Math.round(value)} px`} />
      <RangeField id="appearance-glow" label="Room glow" value={glow} min={0} max={1} step={0.05} disabled={disabled}
        onChange={(value) => later({ glow: value })} low="Dim" high="Bright" format={(value) => `${Math.round(value * 100)}%`} />
      <div className="advanced-colours">
        {colour('accent', 'Accent', '#52dcfa')}
        {colour('accent-secondary', 'Second accent', '#55bace')}
        {colour('surface-tint', 'Surface tint', '#101f2d')}
      </div>
      {hasCustomColours && (
        <button className="secondary-button" type="button" disabled={disabled}
          onClick={() => save({ accent: null, 'accent-secondary': null, 'surface-tint': null })}>Use Jarvis colours</button>
      )}
    </div>
  );
}