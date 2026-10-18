import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CollapsibleSection } from '../CollapsibleSection';
import { Loader } from '../Loader';
import { formatTime } from './ui/formatters';
import {
  draftText,
  loadNutritionTargets,
  NutritionTargetsError,
  nutritionTargetChanges,
  nutritionTargetKeys,
  nutritionTargetsFailureMessage,
  parseNutritionDraft,
  saveNutritionTargets,
  type NutritionDraft,
  type NutritionTargetKey,
  type NutritionTargetsFailure,
  type NutritionTargetsState,
} from './nutrition-targets';
import './nutrition-targets.css';

type Drafts = Record<NutritionTargetKey, string>;
type View =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }
  | { status: 'ready'; state: NutritionTargetsState };
interface Feedback { tone: 'success' | 'error'; message: string }

const emptyDrafts: Drafts = { restingKcal: '', deficitKcal: '', proteinGrams: '' };
const hints: Record<NutritionTargetKey, string> = {
  restingKcal: 'What your body burns in a day before any activity.',
  deficitKcal: 'How far below your burn you aim to finish the day.',
  proteinGrams: 'The protein you aim to eat in a day.',
};

function draftsFrom(state: NutritionTargetsState): Drafts {
  return {
    restingKcal: draftText(state.targets.restingKcal),
    deficitKcal: draftText(state.targets.deficitKcal),
    proteinGrams: draftText(state.targets.proteinGrams),
  };
}

function failureKind(error: unknown): NutritionTargetsFailure {
  return error instanceof NutritionTargetsError ? error.kind : 'failed';
}

function formatSavedAt(value: string): string {
  return formatTime(value);
}

/**
 * The owner's three nutrition targets, shown only while Daily is on. Values are private health data,
 * so there are no defaults or example figures: an unset target stays empty and is reported as unset.
 */
export function NutritionTargetsSettings({ backendUrl, getAccessToken }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
}) {
  const [view, setView] = useState<View>({ status: backendUrl ? 'loading' : 'unavailable' });
  const [drafts, setDrafts] = useState<Drafts>(emptyDrafts);
  const [touched, setTouched] = useState<Partial<Record<NutritionTargetKey, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const request = useRef<AbortController | null>(null);
  const inputs = useRef<Partial<Record<NutritionTargetKey, HTMLInputElement | null>>>({});

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSaving(false);
    setFeedback(null);
    setTouched({});
    setView({ status: 'loading' });
    try {
      const state = await loadNutritionTargets(backendUrl, getAccessToken, controller.signal);
      if (controller.signal.aborted) return;
      setDrafts(draftsFrom(state));
      setView({ status: 'ready', state });
    } catch (error) {
      if (controller.signal.aborted) return;
      const kind = failureKind(error);
      setView(kind === 'unavailable'
        ? { status: 'unavailable' }
        : { status: 'error', message: nutritionTargetsFailureMessage(kind, 'load') });
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
    ? Object.fromEntries(nutritionTargetKeys.map((key) => [key, parseNutritionDraft(drafts[key], ready.bounds[key])])) as Record<NutritionTargetKey, NutritionDraft>
    : null;
  const dirty = ready !== null && parsed !== null && nutritionTargetKeys.some((key) => {
    const draft = parsed[key];
    return !draft.ok || draft.value !== ready.targets[key];
  });

  function edit(key: NutritionTargetKey, value: string) {
    setDrafts((current) => ({ ...current, [key]: value }));
    setFeedback(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !parsed || request.current) return;
    const invalid = nutritionTargetKeys.find((key) => !parsed[key].ok);
    if (invalid) {
      setTouched({ restingKcal: true, deficitKcal: true, proteinGrams: true });
      inputs.current[invalid]?.focus();
      return;
    }
    const changes = nutritionTargetChanges(ready.targets, parsed);
    if (!changes) return;
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    setFeedback(null);
    try {
      const state = await saveNutritionTargets(backendUrl, getAccessToken, changes, controller.signal);
      if (controller.signal.aborted) return;
      setDrafts(draftsFrom(state));
      setTouched({});
      setView({ status: 'ready', state });
      setFeedback({ tone: 'success', message: 'Nutrition targets saved.' });
    } catch (error) {
      if (controller.signal.aborted) return;
      setFeedback({ tone: 'error', message: nutritionTargetsFailureMessage(failureKind(error), 'save') });
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return (
    <CollapsibleSection storageKey="settings.nutrition-targets" headingId="nutrition-targets-heading"
      title="Nutrition targets" className="nutrition-targets"
      summary={view.status === 'ready' ? (view.state.missing.length > 0 ? 'Needs setup' : 'Configured') : undefined}>
      {view.status === 'loading' && (
        <p className="settings-feedback" role="status">
          <Loader variant="inline" announce={false} label="Loading nutrition targets…" />
        </p>
      )}
      {view.status === 'unavailable' && (
        <p className="settings-unavailable" role="status">Nutrition targets are not available here.</p>
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
        <>
          <p className="settings-explanation">
            Jarvis works out what is left to eat today from these figures: resting burn plus the active energy stored
            for today, minus the deficit, minus the meals you have logged. It never estimates them.
          </p>
          <p className="settings-explanation">
            Leave a field empty to clear it. You can also ask Jarvis to change them. They save here, not with Save settings.
          </p>
          {ready.missing.length > 0 && (
            <p className="settings-explanation">
              Not set yet: {ready.missing.map((key) => ready.bounds[key].label).join(', ')}. Jarvis needs all three to work out what is left today.
            </p>
          )}
          <form aria-labelledby="nutrition-targets-heading" aria-busy={saving} noValidate onSubmit={(event) => { void save(event); }}>
            <div className="nutrition-targets-grid">
              {nutritionTargetKeys.map((key) => {
                const bound = ready.bounds[key];
                const draft = parsed[key];
                const error = touched[key] && !draft.ok ? draft.message : '';
                const id = `nutrition-${key}`;
                return (
                  <div className="settings-field" key={key}>
                    <label htmlFor={id}>{bound.label} ({bound.unit})</label>
                    <input id={id} type="text" inputMode="numeric" autoComplete="off" spellCheck={false}
                      value={drafts[key]} readOnly={saving} aria-invalid={error ? true : undefined}
                      aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
                      ref={(node) => { inputs.current[key] = node; }}
                      onChange={(event) => edit(key, event.target.value)}
                      onBlur={() => setTouched((current) => (current[key] ? current : { ...current, [key]: true }))} />
                    <p className="settings-explanation" id={`${id}-hint`}>
                      {hints[key]} Whole number from {bound.min} to {bound.max} {bound.unit}.
                    </p>
                    {error && <p className="settings-validation-error" id={`${id}-error`} role="alert">{error}</p>}
                  </div>
                );
              })}
            </div>
            <div className="settings-actions">
              <button className="primary-button" type="submit" disabled={!dirty || saving}>
                {saving ? 'Saving…' : 'Save nutrition targets'}
              </button>
              <p className="settings-feedback" role={feedback?.tone === 'error' ? 'alert' : 'status'}>
                {feedback?.message}
              </p>
            </div>
          </form>
          {ready.updatedAt && <p className="settings-explanation">Last saved {formatSavedAt(ready.updatedAt)}.</p>}
        </>
      )}
    </CollapsibleSection>
  );
}
