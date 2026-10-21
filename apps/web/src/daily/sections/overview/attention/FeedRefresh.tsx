import { useEffect, useRef, useState } from 'react';
import { DailyReadError, requestJson } from '../../../client';
import type { DailySectionProps } from '../../types';
import { record } from './data';

type Props = Pick<DailySectionProps, 'backendUrl' | 'getAccessToken'> & {
  range: { from: string; to: string }; onCompleted: () => void;
};
const cooldown = 30_000;

export function FeedRefresh({ range, onCompleted, ...props }: Props) {
  const [state, setState] = useState<'idle' | 'pending' | 'running' | 'completed' | 'limited' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const action = useRef<AbortController | null>(null);
  const cooling = until > now;
  useEffect(() => () => { action.current?.abort(); }, [props.backendUrl, props.getAccessToken]);
  useEffect(() => {
    if (!cooling) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooling]);
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  const refresh = async () => {
    if (action.current || Date.now() < until) return;
    const controller = new AbortController();
    action.current = controller;
    const started = Date.now();
    setNow(started); setUntil(started + cooldown); setState('pending'); setMessage('Refreshing Gmail and calendar…');
    try {
      const response = await requestJson(props.backendUrl, '/daily/feeds/refresh', props.getAccessToken, controller.signal, range);
      if (!record(response) || typeof response.runId !== 'string' ||
          !['running', 'completed', 'limited'].includes(String(response.state))) throw new Error('Invalid refresh response');
      if (controller.signal.aborted) return;
      const state = response.state as 'running' | 'completed' | 'limited';
      setState(state);
      if (state === 'limited') {
        setUntil(Date.now() + cooldown); setNow(Date.now());
        setMessage('Refresh limited. No new provider work was started.');
      } else if (state === 'running') {
        setMessage('A refresh is already running. Check again after the cooldown.');
      } else {
        if (response.sources !== undefined && (!Array.isArray(response.sources) ||
            !response.sources.every(source => record(source) && typeof source.source === 'string' &&
              (source.status === 'ok' || source.status === 'error')))) throw new Error('Invalid source results');
        const failed = Array.isArray(response.sources) && response.sources.some(source => record(source) && source.status === 'error');
        setMessage(failed ? 'Refresh completed with source errors. Retained data may be stale.' : 'Refresh completed.');
        onCompleted();
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setState('error'); setMessage(error instanceof DailyReadError ? error.message : 'Could not refresh feeds. Try again after the cooldown.');
      }
    } finally { if (action.current === controller) action.current = null; }
  };
  return <div className="attention-refresh">
    <div className="attention-refresh-status" role={state === 'error' ? 'alert' : 'status'}>
      <span>{message || 'Refresh Gmail and calendar manually.'}</span>
      <span>{seconds > 0 ? `Wait ${seconds}s before refreshing again (30-second cooldown).` : 'Refresh available.'}</span>
    </div>
    <button className="secondary-button" type="button" disabled={state === 'pending' || seconds > 0}
      onClick={() => { void refresh(); }}>{state === 'pending' ? 'Refreshing…' : state === 'running' ? 'Check refresh' : 'Refresh feeds'}</button>
  </div>;
}
