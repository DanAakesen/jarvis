import { useCallback, useEffect, useRef, useState } from 'react';
import { useJarvisActivity } from './activity-context';
import { CollapsibleSection } from './CollapsibleSection';
import { StateMessage } from './StateMessage';
import { saveSignInReturnPath } from './auth';
import {
  isProactiveSettings, proactiveJson, proactiveRequest, ProactiveRequestError,
  type ProactiveSettings as SettingsValue,
} from './proactive-data';

type View =
  | { state: 'loading' }
  | { state: 'loaded' }
  | { state: 'error'; message: string }
  | { state: 'unavailable' };

type LoadOptions = { silent?: boolean; replaceDraft?: boolean };

function needsSignIn(error: unknown): boolean {
  return error instanceof ProactiveRequestError && error.status === 401 ||
    error instanceof Error && error.message.includes('sign-in needs attention');
}

function normalizedSettings(value: SettingsValue): SettingsValue {
  return {
    ...value,
    sources: value.sources.map((source) => ({ ...source })),
    categories: value.categories.map((category) => ({ ...category })),
    newsFeeds: [...value.newsFeeds],
    preferences: [...value.preferences],
    capabilities: {
      ...value.capabilities,
      title: { ...value.capabilities.title },
      examples: value.capabilities.examples.map((example) => ({ ...example })),
    },
  };
}

export function ProactiveSettings({ backendUrl, getAccessToken, signIn }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  signIn?: () => Promise<void>;
}) {
  const [view, setView] = useState<View>(() => backendUrl
    ? { state: 'loading' } : { state: 'error', message: 'Proactive settings are unavailable.' });
  const [saved, setSaved] = useState<SettingsValue | null>(null);
  const [instruction, setInstruction] = useState('');
  const [saving, setSaving] = useState(false);
  const [pauseSaving, setPauseSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const savedRef = useRef(saved);
  const instructionRef = useRef(instruction);
  const { latestActivity } = useJarvisActivity();

  useEffect(() => {
    savedRef.current = saved;
    instructionRef.current = instruction;
  }, [instruction, saved]);

  const load = useCallback(async ({ silent = false, replaceDraft = false }: LoadOptions = {}) => {
    if (!backendUrl) {
      setView({ state: 'error', message: 'Proactive settings are unavailable.' });
      return;
    }
    if (requestRef.current) {
      if (silent) return;
      requestRef.current.abort();
    }
    const controller = new AbortController();
    requestRef.current = controller;
    if (!silent) setView({ state: 'loading' });
    try {
      const response = await proactiveRequest(backendUrl, getAccessToken, '/proactive/settings', {
        signal: controller.signal,
      });
      if (response.status === 404) {
        if (!controller.signal.aborted) setView({ state: 'unavailable' });
        return;
      }
      const value: unknown = await proactiveJson(response);
      if (!isProactiveSettings(value)) throw new Error('Invalid settings');
      if (controller.signal.aborted) return;
      const clean = normalizedSettings(value);
      if (replaceDraft) {
        setSaved(clean);
        setInstruction('');
        setConflict(false);
        setNotice('');
      } else if (instructionRef.current.trim()) {
        setConflict(savedRef.current !== null && savedRef.current.revision !== clean.revision);
      } else {
        setSaved(clean);
        setConflict(false);
      }
      setView({ state: 'loaded' });
    } catch (error) {
      if (!controller.signal.aborted) {
        if (needsSignIn(error)) setSignInRequired(true);
        if (silent && savedRef.current) {
          setNotice(needsSignIn(error)
            ? 'Your sign-in has expired. Sign in again to refresh proactive preferences.'
            : 'Current preferences could not be refreshed. Check your connection and try again.');
        } else {
          setView({ state: 'error', message: needsSignIn(error)
            ? 'Your sign-in has expired. Sign in again to manage proactive settings.'
            : 'Proactive settings could not be loaded. Try again.' });
        }
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [backendUrl, getAccessToken]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
    const refresh = () => {
      if (!document.hidden) void load({ silent: true });
    };
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
      requestRef.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    if (latestActivity?.type === 'tool-call-finished' && latestActivity.outcome === 'ok' &&
        ['chat', 'voice'].includes(latestActivity.source) && latestActivity.toolName === 'proactive_preferences') {
      void Promise.resolve().then(() => load({ silent: true }));
    }
  }, [latestActivity, load]);

  const patchSettings = async (patch: Record<string, unknown>) => {
    const response = await proactiveRequest(backendUrl, getAccessToken, '/proactive/settings', {
      method: 'PATCH',
      body: JSON.stringify({ ...patch, expectedRevision: saved!.revision }),
    });
    const value: unknown = await proactiveJson(response);
    if (!isProactiveSettings(value)) throw new Error('Invalid settings');
    const clean = normalizedSettings(value);
    setSaved(clean);
    setConflict(false);
    return clean;
  };

  const setPaused = async (paused: boolean) => {
    if (!saved || pauseSaving) return;
    setPauseSaving(true);
    setNotice('');
    try {
      await patchSettings({ paused });
      setNotice(paused ? 'Automatic suggestions paused. Requested reminders are unchanged.' : 'Automatic suggestions resumed.');
    } catch (error) {
      if (needsSignIn(error)) setSignInRequired(true);
      if (error instanceof ProactiveRequestError && error.status === 409) setConflict(true);
      setNotice(error instanceof ProactiveRequestError && error.status === 409
        ? 'Preferences changed elsewhere. Reload the current values before changing them.'
        : 'Could not confirm whether this setting was saved. Refresh the current preferences before trying again.');
    } finally {
      setPauseSaving(false);
    }
  };

  const saveInstruction = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!saved || !instruction.trim() || saving) return;
    setSaving(true);
    setNotice('');
    try {
      await patchSettings({ instruction: instruction.trim() });
      setInstruction('');
      setNotice('Saved and confirmed.');
    } catch (error) {
      if (needsSignIn(error)) setSignInRequired(true);
      if (error instanceof ProactiveRequestError && error.status === 409) setConflict(true);
      setNotice(error instanceof ProactiveRequestError && error.status === 422
        ? 'Jarvis cannot enforce that preference yet. Choose one of the supported examples below.'
        : error instanceof ProactiveRequestError && error.status === 409
          ? 'Preferences changed elsewhere. Reload the current values before changing them.'
          : 'Could not confirm whether this preference was saved. Refresh the current preferences before trying again.');
    } finally {
      setSaving(false);
    }
  };

  const beginSignIn = () => {
    saveSignInReturnPath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    void signIn?.();
  };

  const dirty = instruction.trim().length > 0;
  return <CollapsibleSection storageKey="settings.proactive" headingId="proactive-settings-heading"
    title="Proactive" id="proactive-settings" className="proactive-settings" persist={false} initiallyOpen={false}>
    {view.state === 'loading' && <StateMessage variant="loading" message="Loading proactive settings." />}
    {view.state === 'unavailable' && <p role="status">Proactive is not turned on for this backend.</p>}
    {view.state === 'error' && <StateMessage variant="error" message={view.message}
      actionLabel={signInRequired ? 'Sign in again' : 'Retry'}
      onAction={signInRequired ? beginSignIn : () => { void load(); }} />}
    {view.state === 'loaded' && saved && <>
      {signInRequired && <p role="alert">Your sign-in has expired.
        <button className="secondary-button" type="button" onClick={beginSignIn}>Sign in again</button></p>}
      <label className="choice proactive-pause-choice">
        <input type="checkbox" role="switch" checked={!saved.paused} disabled={pauseSaving || saving}
          onChange={(event) => { void setPaused(!event.target.checked); }} />
        Automatic proactive suggestions
      </label>
      <p className="settings-explanation" role="status">
        {saved.paused ? 'Paused' : 'On'} — requested reminders are separate and are not changed by this switch.
      </p>
      <div className="proactive-understood">
        <p><strong>What Jarvis understands</strong></p>
        <ul>{saved.preferences.map((preference) => <li key={preference}>{preference}</li>)}</ul>
      </div>
      <form aria-labelledby="proactive-settings-heading" aria-busy={saving} noValidate onSubmit={(event) => { void saveInstruction(event); }}>
        <div className="settings-field">
          <label htmlFor="proactive-preference-instruction">Change a preference in your own words</label>
          <textarea id="proactive-preference-instruction" rows={2} maxLength={500} value={instruction}
            disabled={saving || pauseSaving}
            placeholder="For example: Show only personal suggestions."
            onChange={(event) => {
              setInstruction(event.target.value);
              setNotice('');
            }} />
        </div>
        <div className="settings-actions">
          <button className="primary-button" type="submit" disabled={!dirty || saving || pauseSaving}>
            {saving ? 'Saving…' : 'Save preference'}
          </button>
          <p className="settings-feedback" role={notice.startsWith('Could not') || notice.startsWith('Jarvis cannot') ||
            notice.startsWith('Preferences changed') ? 'alert' : 'status'}>{notice || (!dirty ? 'No unsaved preference.' : '')}</p>
        </div>
      </form>
      <details className="proactive-preference-help">
        <summary>{saved.capabilities.title.da} / {saved.capabilities.title.en}</summary>
        <ul>{saved.capabilities.examples.map((example) => <li key={example.en}>
          <span>{example.en}</span> <span lang="da">({example.da})</span>
        </li>)}</ul>
      </details>
      {conflict && <p role="alert" className="settings-validation-error">
        Preferences changed while this view was open. Your text has been kept; reload only when you are ready to discard it.
        <button className="secondary-button" type="button" onClick={() => { void load({ replaceDraft: true }); }}>
          Reload current preferences
        </button>
      </p>}
    </>}
  </CollapsibleSection>;
}
