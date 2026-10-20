import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CollapsibleSection } from '../CollapsibleSection';
import { Loader } from '../Loader';
import {
  draftText, loadTrainingTargets, parseTrainingDraft, saveTrainingTargets, trainingTargetChanges,
  trainingTargetKeys, TrainingTargetsError, trainingTargetsFailureMessage,
  type TrainingDraft, type TrainingTargetKey, type TrainingTargetsFailure, type TrainingTargetsState,
} from './training-targets';
import './training-targets.css';

type Drafts = Record<TrainingTargetKey, string>;
type View =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }
  | { status: 'ready'; state: TrainingTargetsState };
interface Feedback { tone: 'success' | 'error'; message: string }

const emptyDrafts: Drafts = { gymSessionsPerWeek: '', runSessionsPerWeek: '', dailySteps: '' };

function draftsFrom(state: TrainingTargetsState): Drafts {
  return {
    gymSessionsPerWeek: draftText(state.targets.gymSessionsPerWeek),
    runSessionsPerWeek: draftText(state.targets.runSessionsPerWeek),
    dailySteps: draftText(state.targets.dailySteps),
  };
}

function failureKind(error: unknown): TrainingTargetsFailure {
  return error instanceof TrainingTargetsError ? error.kind : 'failed';
}

export function TrainingTargetsSettings({ backendUrl, getAccessToken, onState }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  /** Told about every state the server returns, so other views on the page can follow a save. */
  onState?: (state: TrainingTargetsState) => void;
}) {
  const [view, setView] = useState<View>({ status: backendUrl ? 'loading' : 'unavailable' });
  const [drafts, setDrafts] = useState<Drafts>(emptyDrafts);
  const [touched, setTouched] = useState<Partial<Record<TrainingTargetKey, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const request = useRef<AbortController | null>(null);
  const inputs = useRef<Partial<Record<TrainingTargetKey, HTMLInputElement | null>>>({});
  const announce = useRef(onState);
  useEffect(() => { announce.current = onState; }, [onState]);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSaving(false);
    setFeedback(null);
    setTouched({});
    setView({ status: 'loading' });
    try {
      const state = await loadTrainingTargets(backendUrl, getAccessToken, controller.signal);
      if (controller.signal.aborted) return;
      setDrafts(draftsFrom(state));
      setView({ status: 'ready', state });
      announce.current?.(state);
    } catch (error) {
      if (controller.signal.aborted) return;
      const kind = failureKind(error);
      setView(kind === 'unavailable'
        ? { status: 'unavailable' }
        : { status: 'error', message: trainingTargetsFailureMessage(kind, 'load') });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [backendUrl, getAccessToken]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void refresh(); });
    return () => {
      active = false;
      request.current?.abort();
    };
  }, [refresh]);

  const ready = view.status === 'ready' ? view.state : null;
  const parsed = ready
    ? Object.fromEntries(trainingTargetKeys.map((key) => [key, parseTrainingDraft(drafts[key], ready.bounds[key])])) as Record<TrainingTargetKey, TrainingDraft>
    : null;
  const dirty = ready !== null && parsed !== null && trainingTargetKeys.some((key) => {
    const draft = parsed[key];
    return !draft.ok || draft.value !== ready.targets[key];
  });

  function edit(key: TrainingTargetKey, value: string) {
    setDrafts((current) => ({ ...current, [key]: value }));
    setFeedback(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !parsed || request.current) return;
    const invalid = trainingTargetKeys.find((key) => !parsed[key].ok);
    if (invalid) {
      setTouched({ gymSessionsPerWeek: true, runSessionsPerWeek: true, dailySteps: true });
      inputs.current[invalid]?.focus();
      return;
    }
    const changes = trainingTargetChanges(ready.targets, parsed);
    if (!changes) return;
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    setFeedback(null);
    try {
      const state = await saveTrainingTargets(backendUrl, getAccessToken, changes, controller.signal);
      if (controller.signal.aborted) return;
      setDrafts(draftsFrom(state));
      setTouched({});
      setView({ status: 'ready', state });
      setFeedback({ tone: 'success', message: 'Saved' });
      announce.current?.(state);
    } catch (error) {
      if (controller.signal.aborted) return;
      setFeedback({ tone: 'error', message: trainingTargetsFailureMessage(failureKind(error), 'save') });
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return (
    <CollapsibleSection storageKey="settings.training-targets" id="training-targets" headingId="training-targets-heading"
      title="Training targets" className="training-targets"
      summary={view.status === 'ready' ? (view.state.missing.length ? 'Needs setup' : 'Configured') : undefined}>
      {view.status === 'loading' && (
        <p className="settings-feedback" role="status">
          <Loader variant="inline" announce={false} label="Loading training targets…" />
        </p>
      )}
      {view.status === 'unavailable' && (
        <p className="settings-unavailable" role="status">Training targets are not available here.</p>
      )}
      {view.status === 'error' && (
        <>
          <p className="settings-feedback" role="alert">{view.message}</p>
          <div className="settings-actions">
            <button className="secondary-button" type="button" onClick={() => { void refresh(); }}>Retry</button>
          </div>
        </>
      )}
      {ready && parsed && (
        <form aria-labelledby="training-targets-heading" aria-busy={saving} noValidate onSubmit={(event) => { void save(event); }}>
          <div className="training-targets-grid">
            {trainingTargetKeys.map((key) => {
              const bound = ready.bounds[key];
              const draft = parsed[key];
              const error = touched[key] && !draft.ok ? draft.message : '';
              const id = `training-${key}`;
              return (
                <div className="settings-field" key={key}>
                  <label htmlFor={id}>{bound.label} ({bound.unit})</label>
                  <input id={id} type="text" inputMode="numeric" autoComplete="off" spellCheck={false}
                    value={drafts[key]} readOnly={saving} aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                    ref={(node) => { inputs.current[key] = node; }}
                    onChange={(event) => edit(key, event.target.value)}
                    onBlur={() => setTouched((current) => (current[key] ? current : { ...current, [key]: true }))} />
                  {error && <p className="settings-validation-error" id={`${id}-error`} role="alert">{error}</p>}
                </div>
              );
            })}
          </div>
          <div className="settings-actions">
            <button className="primary-button" type="submit" disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save training targets'}
            </button>
            <p className="settings-feedback" role={feedback?.tone === 'error' ? 'alert' : 'status'}>
              {feedback?.message}
            </p>
          </div>
        </form>
      )}
    </CollapsibleSection>
  );
}
