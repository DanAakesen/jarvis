import { useRef, useState, type FormEvent } from 'react';
import { CollapsibleSection } from '../CollapsibleSection';
import { Loader } from '../Loader';
import {
  draftText, parseTrainingDraft, saveTrainingTargets, trainingTargetChanges,
  trainingTargetKeys, TrainingTargetsError, trainingTargetsFailureMessage, useTrainingTargets,
  type TrainingDraft, type TrainingTargetKey, type TrainingTargetsFailure, type TrainingTargetsState,
} from './training-targets';
import type { TrainingTargetsShared } from './training-targets-context';
import './training-targets.css';

type Drafts = Record<TrainingTargetKey, string>;
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

/**
 * The editor never reads targets itself. It shows what `source` holds and hands every state a save returns to
 * `source.apply`, so the Health area's cards follow a save without another read.
 */
export function TrainingTargetsEditor({ backendUrl, getAccessToken, source }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  source: Pick<TrainingTargetsShared, 'view' | 'retry' | 'apply'>;
}) {
  const { view, retry, apply } = source;
  const ready = view.status === 'settled' ? view.state : null;
  const [seen, setSeen] = useState(ready);
  const [drafts, setDrafts] = useState<Drafts>(() => (ready ? draftsFrom(ready) : emptyDrafts));
  const [touched, setTouched] = useState<Partial<Record<TrainingTargetKey, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const request = useRef<AbortController | null>(null);
  const inputs = useRef<Partial<Record<TrainingTargetKey, HTMLInputElement | null>>>({});

  // A newer answer from the server replaces the fields, unless the owner has edits in progress: those are kept and
  // compared with the new answer.
  if (ready !== null && ready !== seen) {
    setSeen(ready);
    const baseline = seen === null ? null : draftsFrom(seen);
    if (baseline === null || trainingTargetKeys.every((key) => drafts[key] === baseline[key])) {
      setDrafts(draftsFrom(ready));
      setTouched({});
    }
  }
  if (ready === null && feedback !== null) setFeedback(null);

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
    // Leaving the page does not cancel a save: the server may already hold it, and its answer must still reach `apply`.
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    setFeedback(null);
    try {
      const state = await saveTrainingTargets(backendUrl, getAccessToken, changes, controller.signal);
      setDrafts(draftsFrom(state));
      setTouched({});
      setFeedback({ tone: 'success', message: 'Saved' });
      apply(state);
    } catch (error) {
      setFeedback({ tone: 'error', message: trainingTargetsFailureMessage(failureKind(error), 'save') });
    } finally {
      request.current = null;
      setSaving(false);
    }
  }

  return (
    <CollapsibleSection storageKey="settings.training-targets" id="training-targets" headingId="training-targets-heading"
      title="Training targets" className="training-targets"
      summary={ready ? (ready.missing.length ? 'Needs setup' : 'Configured') : undefined}>
      {view.status === 'loading' && (
        <p className="settings-feedback" role="status">
          <Loader variant="inline" announce={false} label="Loading training targets…" />
        </p>
      )}
      {view.status === 'error' && view.kind === 'unavailable' && (
        <p className="settings-unavailable" role="status">Training targets are not available here.</p>
      )}
      {view.status === 'error' && view.kind !== 'unavailable' && (
        <>
          <p className="settings-feedback" role="alert">{view.message}</p>
          <div className="settings-actions">
            <button className="secondary-button" type="button" onClick={retry}>Retry</button>
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

/** The editor with a read of its own, for the Settings page, which sits outside the Health area and its shared read. */
export function TrainingTargetsSettings({ backendUrl, getAccessToken }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
}) {
  const source = useTrainingTargets(backendUrl, getAccessToken, backendUrl !== null);
  return <TrainingTargetsEditor backendUrl={backendUrl} getAccessToken={getAccessToken} source={source} />;
}
