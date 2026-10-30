import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import type { DailySectionProps } from '../types';
import { useDailyPages } from '../../ui/useDailyPages';
import { formatNumber, formatTime } from '../../ui/formatters';
import { Loader } from '../../../Loader';
import { createLift, deleteLift, LiftWriteError, updateLift, type LiftDraft, type LiftEntry } from '../../lifts-client';
import './track-workout.css';

interface LiftFormValues {
  exerciseName: string;
  weightKg: string;
  reps: string;
  sets: string;
}

const emptyForm: LiftFormValues = { exerciseName: '', weightKg: '', reps: '', sets: '' };
const normalizedName = (value: string) => value.trim().toLowerCase();
const liftQuery = { source: sources.lifts, limit: 100, lastPerExercise: true } as const;
const historyQuery = { source: sources.lifts, limit: 50 } as const;

function liftEntries(items: readonly Record<string, unknown>[]): LiftEntry[] {
  return items as unknown as LiftEntry[];
}

function draftFrom(entry: LiftEntry): LiftFormValues {
  return {
    exerciseName: entry.exerciseName, weightKg: String(entry.weightKg),
    reps: String(entry.reps), sets: String(entry.sets),
  };
}

function checkedDraft(values: LiftFormValues): LiftDraft | null {
  const weightKg = Number(values.weightKg);
  const reps = Number(values.reps);
  const sets = Number(values.sets);
  if (!values.exerciseName.trim() || values.exerciseName.trim().length > 80 ||
      !Number.isFinite(weightKg) || weightKg < 0 || weightKg > 1000 ||
      Math.abs(weightKg * 100 - Math.round(weightKg * 100)) >= 1e-7 ||
      !Number.isSafeInteger(reps) || reps < 1 || reps > 1000 ||
      !Number.isSafeInteger(sets) || sets < 1 || sets > 100) return null;
  return { exerciseName: values.exerciseName.trim(), weightKg, reps, sets };
}

function message(error: unknown, fallback: string) {
  return error instanceof LiftWriteError ? error.message : fallback;
}

export default function TrackWorkoutSection({ backendUrl, getAccessToken, sources: available, refreshVersion }: DailySectionProps) {
  const hasLifts = available.includes(sources.lifts);
  const recent = useDailyPages(backendUrl, getAccessToken, hasLifts ? historyQuery : null, refreshVersion, { maxPages: 50 });
  const known = useDailyPages(backendUrl, getAccessToken, hasLifts ? liftQuery : null, refreshVersion,
    { maxPages: 50, autoLoad: true, settle: true });
  const knownEntries = liftEntries(known.items);
  const recentEntries = liftEntries(recent.items);
  const options = useMemo(() => [...new Set(knownEntries.map(row => row.exerciseName))], [known.items]);
  const [values, setValues] = useState<LiftFormValues>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState(false);
  const [edit, setEdit] = useState<{ id: string; values: LiftFormValues } | null>(null);
  const [rowBusy, setRowBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const idempotency = useRef<{ fingerprint: string; key: string } | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const retryRow = useRef<() => void>(() => {});
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      activeRequest.current?.abort();
    };
  }, []);

  const selectedLast = knownEntries.find(row => normalizedName(row.exerciseName) === normalizedName(values.exerciseName));

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (saving || !online) return;
    const draft = checkedDraft(values);
    if (!draft) {
      setFormError('Check the exercise name, weight, reps and sets.');
      setFormSuccess(false);
      return;
    }
    const fingerprint = JSON.stringify(draft);
    const key = idempotency.current?.fingerprint === fingerprint ? idempotency.current.key : crypto.randomUUID();
    idempotency.current = { fingerprint, key };
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setSaving(true);
    setFormError(null);
    setFormSuccess(false);
    try {
      await createLift(backendUrl, getAccessToken, { ...draft, idempotencyKey: key }, controller.signal);
      if (controller.signal.aborted) return;
      idempotency.current = null;
      setFormSuccess(true);
      recent.reload();
      known.reload();
    } catch (error) {
      if (!controller.signal.aborted) setFormError(message(error, 'Lift could not be saved. Try again.'));
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  };

  const saveEdit = async (id: string, draft: LiftDraft) => {
    if (rowBusy || !online) return;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setRowBusy(true);
    setRowError(null);
    retryRow.current = () => { void saveEdit(id, draft); };
    try {
      await updateLift(backendUrl, getAccessToken, id, draft, controller.signal);
      if (controller.signal.aborted) return;
      setEdit(null);
      setFormSuccess(false);
      recent.reload();
      known.reload();
    } catch (error) {
      if (!controller.signal.aborted) setRowError(message(error, 'Lift could not be updated. Try again.'));
    } finally {
      if (!controller.signal.aborted) setRowBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (rowBusy || !online) return;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setRowBusy(true);
    setRowError(null);
    retryRow.current = () => { void remove(id); };
    try {
      await deleteLift(backendUrl, getAccessToken, id, controller.signal);
      if (controller.signal.aborted) return;
      setDeleteId(null);
      recent.reload();
      known.reload();
    } catch (error) {
      if (!controller.signal.aborted) setRowError(message(error, 'Lift could not be deleted. Try again.'));
    } finally {
      if (!controller.signal.aborted) setRowBusy(false);
    }
  };

  return <section className="track-workout" aria-label="Track workout">
    {!online && <p className="track-workout-offline" role="status">Offline. Lifts are not sent until you reconnect.</p>}
    <section aria-labelledby="lift-entry-heading">
      <h2 id="lift-entry-heading">Log a lift</h2>
      <form ref={form} className="lift-entry-form" onSubmit={event => { void submit(event); }} aria-busy={saving}>
        <label>Exercise
          <input required maxLength={80} value={values.exerciseName} list="lift-exercise-names"
            onChange={event => {
              const exerciseName = event.target.value;
              setValues(previous => ({ ...previous, exerciseName }));
              const match = knownEntries.find(row => normalizedName(row.exerciseName) === normalizedName(exerciseName));
              if (match) setValues(draftFrom(match));
              setFormError(null);
              setFormSuccess(false);
            }} />
        </label>
        <datalist id="lift-exercise-names">{options.map(name => <option value={name} key={name} />)}</datalist>
        <label>Weight (kg)
          <input required type="number" inputMode="decimal" min="0" max="1000" step="0.01"
            value={values.weightKg} onChange={event => { setValues(previous => ({ ...previous, weightKg: event.target.value })); setFormError(null); setFormSuccess(false); }} />
        </label>
        <label>Reps
          <input required type="number" inputMode="numeric" min="1" max="1000" step="1"
            value={values.reps} onChange={event => { setValues(previous => ({ ...previous, reps: event.target.value })); setFormError(null); setFormSuccess(false); }} />
        </label>
        <label>Sets
          <input required type="number" inputMode="numeric" min="1" max="100" step="1"
            value={values.sets} onChange={event => { setValues(previous => ({ ...previous, sets: event.target.value })); setFormError(null); setFormSuccess(false); }} />
        </label>
        {selectedLast && <p className="lift-last-used">Last used {formatTime(selectedLast.performedAt)}</p>}
        <div className="button-group lift-entry-actions">
          <button className="primary-button" type="submit" disabled={saving || !online} aria-busy={saving}>
            <span className="button-label">Save lift</span>
            <span className="button-loading-indicator" aria-hidden="true"><Loader label="Saving lift" variant="inline" announce={false} /></span>
          </button>
          {formError && <button className="secondary-button" type="button" disabled={saving || !online} onClick={() => form.current?.requestSubmit()}>Retry</button>}
        </div>
        {formError && <p className="lift-form-error" role="alert">{formError}</p>}
        {formSuccess && <p className="lift-form-success" role="status">Lift saved.</p>}
      </form>
    </section>

    <section aria-labelledby="lift-history-heading" aria-busy={recent.status === 'loading' || recent.loadingMore}>
      <h2 id="lift-history-heading">Lift history</h2>
      {recent.status === 'loading' && recentEntries.length === 0 && <Loader label="Loading lifts" variant="rows" />}
      {recent.error && <div className="lift-history-error" role="alert">
        <p>{recent.error}</p><button className="secondary-button" type="button" onClick={recent.reload}>Retry</button>
      </div>}
      {recent.status === 'ready' && recentEntries.length === 0 && <p role="status">No lifts logged.</p>}
      {recentEntries.length > 0 && <ul className="lift-history-list" aria-label="Recorded lifts">
        {recentEntries.map(entry => <li className="lift-history-row" key={entry.id}>
          <div className="lift-history-entry">
            <strong>{entry.exerciseName}</strong>
            <span>{formatNumber(entry.weightKg)} kg · {entry.reps} reps · {entry.sets} sets</span>
            <time dateTime={entry.performedAt}>{formatTime(entry.performedAt)}</time>
          </div>
          {edit?.id === entry.id ? <form className="lift-edit-form" onSubmit={event => {
            event.preventDefault();
            const draft = checkedDraft(edit.values);
            if (draft) void saveEdit(entry.id, draft);
            else setRowError('Check the exercise name, weight, reps and sets.');
          }}>
            <label>Exercise<input required maxLength={80} value={edit.values.exerciseName}
              onChange={event => { setRowError(null); setEdit(previous => previous ? { ...previous, values: { ...previous.values, exerciseName: event.target.value } } : previous); }} /></label>
            <label>Weight (kg)<input required type="number" min="0" max="1000" step="0.01" value={edit.values.weightKg}
              onChange={event => { setRowError(null); setEdit(previous => previous ? { ...previous, values: { ...previous.values, weightKg: event.target.value } } : previous); }} /></label>
            <label>Reps<input required type="number" min="1" max="1000" step="1" value={edit.values.reps}
              onChange={event => { setRowError(null); setEdit(previous => previous ? { ...previous, values: { ...previous.values, reps: event.target.value } } : previous); }} /></label>
            <label>Sets<input required type="number" min="1" max="100" step="1" value={edit.values.sets}
              onChange={event => { setRowError(null); setEdit(previous => previous ? { ...previous, values: { ...previous.values, sets: event.target.value } } : previous); }} /></label>
            <div className="button-group">
              <button className="primary-button" type="submit" disabled={rowBusy || !online}>Save changes</button>
              <button className="secondary-button" type="button" disabled={rowBusy} onClick={() => { setEdit(null); setRowError(null); }}>Cancel</button>
            </div>
          </form> : <div className="button-group lift-row-actions">
            <button className="secondary-button" type="button" disabled={rowBusy} onClick={() => {
              setEdit({ id: entry.id, values: draftFrom(entry) });
              setDeleteId(null);
              setRowError(null);
            }}>Edit</button>
            {deleteId === entry.id
              ? <>
                <button className="danger-button" type="button" disabled={rowBusy || !online} onClick={() => { void remove(entry.id); }}>Confirm delete</button>
                <button className="secondary-button" type="button" disabled={rowBusy} onClick={() => setDeleteId(null)}>Cancel</button>
              </>
              : <button className="danger-button" type="button" disabled={rowBusy} onClick={() => { setDeleteId(entry.id); setEdit(null); setRowError(null); }}>Delete</button>}
          </div>}
        </li>)}
      </ul>}
      {rowError && <div className="lift-row-error" role="alert">
        <p>{rowError}</p><button className="secondary-button" type="button" disabled={rowBusy || !online} onClick={() => retryRow.current()}>Retry</button>
      </div>}
      {recent.hasMore && <div className="lift-history-more">
        <button className="secondary-button" type="button" disabled={recent.loadingMore || recent.capped} onClick={recent.loadMore}>
          {recent.loadingMore ? 'Loading…' : 'Load more'}
        </button>
      </div>}
      {known.error && <div className="lift-history-error" role="alert">
        <p>Exercise names could not be loaded.</p><button className="secondary-button" type="button" onClick={known.reload}>Retry names</button>
      </div>}
    </section>
  </section>;
}
