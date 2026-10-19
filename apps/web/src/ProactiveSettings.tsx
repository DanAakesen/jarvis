import { useCallback, useEffect, useRef, useState } from 'react';
import { CollapsibleSection } from './CollapsibleSection';
import { StateMessage } from './StateMessage';
import { saveSignInReturnPath } from './auth';
import {
  isProactiveSettings, isRecord, proactiveJson, proactiveRequest, ProactiveRequestError, sourceLabels,
  type ProactiveSettings as SettingsValue, type SourceId,
} from './proactive-data';

type View =
  | { state: 'loading' }
  | { state: 'loaded' }
  | { state: 'error'; message: string }
  | { state: 'unavailable' };

type Draft = Omit<SettingsValue, 'paused' | 'monthlyBudgetDkk'> & { monthlyBudgetDkk: string };

function needsSignIn(error: unknown): boolean {
  return error instanceof ProactiveRequestError && error.status === 401 ||
    error instanceof Error && error.message.includes('sign-in needs attention');
}

function normalizedSettings(value: SettingsValue): SettingsValue {
  const ids: SourceId[] = ['todos', 'calendar', 'mail', 'weather', 'factory', 'news', 'travel', 'x'];
  return {
    ...value,
    sources: ids.map((id) => ({
      id,
      enabled: id === 'x' ? false : value.sources.find((source) => source.id === id)?.enabled ?? false,
    })),
  };
}

function draftFrom(value: SettingsValue): Draft {
  return {
    monthlyBudgetDkk: String(value.monthlyBudgetDkk),
    sources: value.sources.map((source) => ({ ...source })),
    newsFeeds: [...value.newsFeeds],
    guidance: value.guidance,
  };
}

function canonicalFeed(value: string): string | null {
  if (!value || value.length > 300) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function validateFeeds(feeds: string[]): Record<number, string> {
  const errors: Record<number, string> = {};
  const seen = new Set<string>();
  if (feeds.length > 10) errors[0] = 'Add no more than 10 news feeds.';
  feeds.forEach((feed, index) => {
    if (!feed) errors[index] = 'Enter an HTTPS URL.';
    else if (feed.length > 300) errors[index] = 'Use a URL of at most 300 characters.';
    else {
      const canonical = canonicalFeed(feed);
      if (!canonical) errors[index] = 'Enter a valid HTTPS URL.';
      else if (seen.has(canonical)) errors[index] = 'Each feed URL must be unique.';
      else seen.add(canonical);
    }
  });
  return errors;
}

export function ProactiveSettings({ backendUrl, getAccessToken, signIn }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  signIn?: () => Promise<void>;
}) {
  const [view, setView] = useState<View>(() => backendUrl
    ? { state: 'loading' } : { state: 'error', message: 'Proactive settings are unavailable.' });
  const [saved, setSaved] = useState<SettingsValue | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [pauseSaving, setPauseSaving] = useState(false);
  const [budgetTouched, setBudgetTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);

  const load = useCallback(async () => {
    if (!backendUrl) { setView({ state: 'error', message: 'Proactive settings are unavailable.' }); return; }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setView({ state: 'loading' });
    setNotice('');
    try {
      const response = await proactiveRequest(backendUrl, getAccessToken, '/proactive/settings', { signal: controller.signal });
      if (response.status === 404) { setView({ state: 'unavailable' }); return; }
      const value: unknown = await proactiveJson(response);
      if (!isProactiveSettings(value)) throw new Error('Invalid settings');
      if (controller.signal.aborted) return;
      const clean = normalizedSettings(value);
      setSaved(clean);
      setDraft(draftFrom(clean));
      setView({ state: 'loaded' });
    } catch (error) {
      if (!controller.signal.aborted) {
        if (needsSignIn(error)) setSignInRequired(true);
        setView({ state: 'error', message: needsSignIn(error)
          ? 'Your sign-in has expired. Sign in again to manage proactive settings.'
          : 'Proactive settings could not be loaded. Try again.' });
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [backendUrl, getAccessToken]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(); });
    return () => {
      active = false;
      requestRef.current?.abort();
    };
  }, [load]);

  const setPaused = async (paused: boolean) => {
    if (!saved || pauseSaving) return;
    setPauseSaving(true);
    setFieldErrors({});
    setNotice('');
    try {
      const response = await proactiveRequest(backendUrl, getAccessToken, '/proactive/settings', {
        method: 'PATCH', body: JSON.stringify({ paused }),
      });
      const value: unknown = await proactiveJson(response);
      if (!isProactiveSettings(value)) throw new Error('Invalid settings');
      const clean = normalizedSettings(value);
      setSaved(clean);
      setDraft((current) => current ? { ...current, sources: clean.sources } : draftFrom(clean));
      setNotice(paused ? 'Paused' : 'Resumed');
    } catch (error) {
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
      if (needsSignIn(error)) setSignInRequired(true);
      setFieldErrors({ paused: status === 400 ? 'Check this setting and try again.' : 'Could not save this setting. Try again.' });
    } finally {
      setPauseSaving(false);
    }
  };

  const beginSignIn = () => {
    saveSignInReturnPath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    void signIn?.();
  };

  const updateSource = (id: SourceId, enabled: boolean) => {
    setDraft((current) => current ? ({
      ...current, sources: current.sources.map((source) => source.id === id ? { ...source, enabled } : source),
    }) : current);
    setFieldErrors({});
    setNotice('');
  };

  const dirty = Boolean(saved && draft && (
    saved.monthlyBudgetDkk !== Number(draft.monthlyBudgetDkk) ||
    saved.guidance !== draft.guidance ||
    JSON.stringify(saved.newsFeeds) !== JSON.stringify(draft.newsFeeds) ||
    saved.sources.some((source) => source.id !== 'x' &&
      draft.sources.find((next) => next.id === source.id)?.enabled !== source.enabled)
  ));
  const budgetValue = draft ? Number(draft.monthlyBudgetDkk) : 0;
  const budgetValid = Boolean(draft?.monthlyBudgetDkk !== '') &&
    Number.isSafeInteger(budgetValue) && budgetValue >= 0 && budgetValue <= 1000;
  const feedsValid = Boolean(draft && Object.keys(validateFeeds(draft.newsFeeds)).length === 0);
  const guidanceValid = Boolean(draft && draft.guidance.length <= 1000);
  const validationErrors = draft ? validateFeeds(draft.newsFeeds) : {};
  const saveValid = budgetValid && feedsValid && guidanceValid;

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!saved || !draft || !dirty || !saveValid || saving) return;
    const changedSources = draft.sources.filter((source) => source.id !== 'x' &&
      saved.sources.find((old) => old.id === source.id)?.enabled !== source.enabled);
    const patch = {
      ...(saved.monthlyBudgetDkk !== budgetValue ? { monthlyBudgetDkk: budgetValue } : {}),
      ...(changedSources.length > 0 ? { sources: changedSources } : {}),
      ...(JSON.stringify(saved.newsFeeds) !== JSON.stringify(draft.newsFeeds) ? { newsFeeds: draft.newsFeeds } : {}),
      ...(saved.guidance !== draft.guidance ? { guidance: draft.guidance } : {}),
    };
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    setFieldErrors({});
    setNotice('');
    try {
      const response = await proactiveRequest(backendUrl, getAccessToken, '/proactive/settings', {
        method: 'PATCH', body: JSON.stringify(patch),
      });
      const value: unknown = await proactiveJson(response);
      if (!isProactiveSettings(value)) throw new Error('Invalid settings');
      const clean = normalizedSettings(value);
      setSaved(clean);
      setDraft(draftFrom(clean));
      setBudgetTouched(false);
      setNotice('Saved');
    } catch (error) {
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
      if (needsSignIn(error)) setSignInRequired(true);
      const copy = status === 400 ? 'Check this value and try again.' : 'Could not save this setting. Try again.';
      const errors: Record<string, string> = {};
      if ('monthlyBudgetDkk' in patch) errors.monthlyBudgetDkk = copy;
      if ('sources' in patch) errors.sources = copy;
      if ('newsFeeds' in patch) errors.newsFeeds = copy;
      if ('guidance' in patch) errors.guidance = copy;
      setFieldErrors(errors);
    } finally {
      setSaving(false);
    }
  };

  return <CollapsibleSection storageKey="settings.proactive" headingId="proactive-settings-heading"
    title="Proactive" id="proactive-settings" className="proactive-settings" persist={false} initiallyOpen={false}>
    {view.state === 'loading' && <StateMessage variant="loading" message="Loading proactive settings." />}
    {view.state === 'unavailable' && <p role="status">Proactive is not turned on for this backend.</p>}
    {view.state === 'error' && <StateMessage variant="error" message={view.message}
      actionLabel={signInRequired ? 'Sign in again' : 'Retry'}
      onAction={signInRequired ? beginSignIn : () => { void load(); }} />}
    {view.state === 'loaded' && saved && draft && <>
      {signInRequired && <p role="alert">Your sign-in has expired.
        <button className="secondary-button" type="button" onClick={beginSignIn}>Sign in again</button></p>}
      <label className="choice proactive-pause-choice">
        <input type="checkbox" role="switch" checked={saved.paused} disabled={pauseSaving}
          onChange={(event) => { void setPaused(event.target.checked); }} />
        Pause proactive checks
      </label>
      {fieldErrors.paused && <p role="alert" className="settings-validation-error">{fieldErrors.paused}</p>}
      <form aria-labelledby="proactive-settings-heading" aria-busy={saving} noValidate onSubmit={(event) => { void save(event); }}>
        <div className="settings-field settings-number-field">
          <label htmlFor="proactive-budget-input">Monthly budget (DKK)</label>
          <input id="proactive-budget-input" type="number" min="0" max="1000" step="1"
            value={draft.monthlyBudgetDkk} disabled={saving}
            aria-invalid={budgetTouched && !budgetValid || Boolean(fieldErrors.monthlyBudgetDkk)}
            aria-describedby="proactive-budget-error"
            onChange={(event) => {
              setBudgetTouched(true);
              setDraft((current) => current ? { ...current, monthlyBudgetDkk: event.target.value } : current);
              setFieldErrors({});
            }} />
          {(budgetTouched && !budgetValid || fieldErrors.monthlyBudgetDkk) &&
            <p className="settings-validation-error" id="proactive-budget-error" role="alert">
              {fieldErrors.monthlyBudgetDkk ?? 'Enter a whole number from 0 to 1,000.'}
            </p>}
        </div>

        <fieldset className="proactive-source-settings">
          <legend>Sources</legend>
          {draft.sources.map(({ id, enabled }) => <label className="choice" key={id}>
            <input type="checkbox" role="switch" checked={id === 'x' ? false : enabled}
              disabled={saving || id === 'x'} aria-describedby={id === 'x' ? `proactive-source-${id}-reason` : undefined}
              onChange={(event) => { updateSource(id, event.target.checked); }} />
            {sourceLabels[id]}
            {id === 'x' && <span id={`proactive-source-${id}-reason`}>Off. No provider connected.</span>}
          </label>)}
          {fieldErrors.sources && <p className="settings-validation-error" role="alert">{fieldErrors.sources}</p>}
        </fieldset>

        <fieldset className="settings-field proactive-feeds">
          <legend>News feeds</legend>
          {draft.newsFeeds.map((feed, index) => <div className="proactive-feed-field" key={index}>
            <label htmlFor={`proactive-feed-${index}`}>Feed {index + 1}</label>
            <div className="proactive-feed-input">
              <input id={`proactive-feed-${index}`} type="url" inputMode="url" maxLength={300}
                value={feed} disabled={saving} aria-invalid={Boolean(validationErrors[index] || fieldErrors.newsFeeds)}
                aria-describedby={`proactive-feed-${index}-error`}
                onChange={(event) => {
                  setDraft((current) => current ? {
                    ...current, newsFeeds: current.newsFeeds.map((value, position) => position === index ? event.target.value : value),
                  } : current);
                  setFieldErrors({});
                }} />
              <button className="secondary-button" type="button" disabled={saving} aria-label={`Remove feed ${index + 1}`}
                onClick={() => setDraft((current) => current ? {
                  ...current, newsFeeds: current.newsFeeds.filter((_value, position) => position !== index),
                } : current)}>Remove</button>
            </div>
            {(validationErrors[index] || fieldErrors.newsFeeds) && <p className="settings-validation-error"
              id={`proactive-feed-${index}-error`} role="alert">{validationErrors[index] ?? fieldErrors.newsFeeds}</p>}
          </div>)}
          {draft.newsFeeds.length < 10 && <button className="secondary-button" type="button" disabled={saving}
            onClick={() => setDraft((current) => current ? { ...current, newsFeeds: [...current.newsFeeds, ''] } : current)}>
            Add feed
          </button>}
        </fieldset>

        <div className="settings-field">
          <label htmlFor="proactive-guidance">Guidance</label>
          <textarea id="proactive-guidance" rows={5} maxLength={1000} value={draft.guidance}
            disabled={saving} aria-invalid={!guidanceValid || Boolean(fieldErrors.guidance)}
            aria-describedby="proactive-guidance-count proactive-guidance-error"
            onChange={(event) => {
              setDraft((current) => current ? { ...current, guidance: event.target.value } : current);
              setFieldErrors({});
            }} />
          <p className="settings-explanation" id="proactive-guidance-count">{draft.guidance.length} / 1,000 characters</p>
          {(!guidanceValid || fieldErrors.guidance) && <p className="settings-validation-error"
            id="proactive-guidance-error" role="alert">{fieldErrors.guidance ?? 'Use at most 1,000 characters.'}</p>}
        </div>
        <div className="settings-actions">
          <button className="primary-button" type="submit" disabled={!dirty || !saveValid || saving}>
            {saving ? 'Saving…' : 'Save proactive settings'}
          </button>
          <p className="settings-feedback" role={Object.keys(fieldErrors).length ? 'alert' : 'status'}>{notice}</p>
        </div>
      </form>
    </>}
  </CollapsibleSection>;
}
