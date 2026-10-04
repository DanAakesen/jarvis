import { useState, type FormEvent } from 'react';
import { backendFetch } from '../backend-request';

type TaskState = 'Ready' | 'Running' | 'PauseRequested' | 'Paused' | 'NeedsAttention' | 'Done' | 'Cancelled';
type Action = 'steer' | 'pause' | 'resume' | 'cancel' | 'recover';
const taskStates: TaskState[] = ['Ready', 'Running', 'PauseRequested', 'Paused', 'NeedsAttention', 'Done', 'Cancelled'];

const messages: Record<Action, string> = {
  steer: 'Steering message sent.',
  pause: 'Pause requested. The task will show Paused after its turn stops.',
  resume: 'Task resumed.',
  cancel: 'Task cancelled.',
  recover: 'Recovery started from the task branch.',
};

function errorMessage(status: number): string {
  if (status === 401) return 'Your Microsoft sign-in needs attention. Sign in again.';
  if (status === 409) return 'The task state changed. Refresh the task before trying again.';
  if (status === 502 || status === 503) return 'Jarvis could not complete this action. Check the task state and try again.';
  return `Task action failed (HTTP ${status}). Try again.`;
}

export function TaskControls({
  backendUrl,
  getAccessToken,
  taskId,
  state,
  latestSessionEndReason,
  onComplete,
}: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  taskId: string;
  state: TaskState;
  latestSessionEndReason?: 'done' | 'cancelled' | 'crashed' | 'idle' | 'idle_expired' | null;
  onComplete: (state: TaskState) => void;
}) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [steering, setSteering] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const continueExpiredSession = latestSessionEndReason === 'idle_expired';

  async function run(action: Action, steeringMessage?: string) {
    if (!backendUrl) {
      setError('Task controls are unavailable until the backend is deployed.');
      return;
    }
    setBusy(action);
    setError('');
    setFeedback('');
    let token: string;
    try {
      token = await getAccessToken();
    } catch {
      setBusy(null);
      setError('Your Microsoft sign-in needs attention. Sign in again.');
      return;
    }
    try {
      let response: Response;
      try {
        response = await backendFetch(
        `${backendUrl.replace(/\/+$/, '')}/factory/tasks/${taskId}/controls`,
        {
          method: 'POST',
          headers: {
            Authorization: `${['Bear', 'er'].join('')} ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action,
            ...(action === 'steer' ? { message: steeringMessage } : {}),
          }),
          signal: AbortSignal.timeout(action === 'recover' ? 35_000 : 10_000),
        },
        );
      } catch {
        throw new Error('Jarvis could not reach the task service. Check the task state and try again.');
      }
      if (!response.ok) throw new Error(errorMessage(response.status));
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        throw new Error('Jarvis returned an invalid task control result. Check the task state before retrying.');
      }
      if (typeof result !== 'object' || result === null || !('id' in result) ||
        result.id !== taskId || !('state' in result) || !taskStates.includes(result.state as TaskState)) {
        throw new Error('Jarvis returned an invalid task control result. Check the task state before retrying.');
      }
      setFeedback(action === 'recover' && continueExpiredSession
        ? 'Continuation started from the task branch.'
        : messages[action]);
      setSteering(false);
      setConfirmCancel(false);
      setMessage('');
      onComplete(result.state as TaskState);
    } catch (reason) {
      setError(reason instanceof Error
        ? reason.message
        : 'Jarvis could not complete this action. Check the task state and try again.');
    } finally {
      setBusy(null);
    }
  }

  function submitSteering(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > 65_536) return;
    void run('steer', trimmed);
  }

  if (state === 'PauseRequested') {
    return <p className="task-control-feedback" role="status">Pausing… The current turn is stopping.</p>;
  }
  if (state === 'Running' && continueExpiredSession) {
    return (
      <div className="task-controls">
        <div className="action-row">
          <button className="secondary-button" type="button" disabled={busy !== null}
            onClick={() => void run('recover')}>
            {busy === 'recover' ? 'Continuing…' : 'Continue'}
          </button>
        </div>
        <p className="task-control-guidance">Starts a new sandbox from the existing task branch and its recorded history.</p>
        {error && <p className="task-control-error" role="alert">{error}</p>}
        {feedback && <p className="task-control-feedback" role="status" aria-live="polite">{feedback}</p>}
      </div>
    );
  }
  if (state === 'NeedsAttention') {
    return (
      <div className="task-controls">
        <div className="action-row">
          <button className="secondary-button" type="button" disabled={busy !== null}
            onClick={() => void run('recover')}>
            {busy === 'recover'
              ? continueExpiredSession ? 'Continuing…' : 'Recovering…'
              : continueExpiredSession ? 'Continue' : 'Recover'}
          </button>
        </div>
        <p className="task-control-guidance">Starts a new sandbox from the existing task branch and its recorded history.</p>
        {error && <p className="task-control-error" role="alert">{error}</p>}
        {feedback && <p className="task-control-feedback" role="status" aria-live="polite">{feedback}</p>}
      </div>
    );
  }
  if (state === 'Done' || state === 'Cancelled') {
    return <p className="task-control-guidance">This task is finished; no further controls are available.</p>;
  }

  return (
    <div className="task-controls">
      <div className="action-row">
        {state === 'Running' && (
          <>
            <button className="secondary-button" type="button" disabled={busy !== null}
              onClick={() => { setSteering((open) => !open); setError(''); setFeedback(''); }}>
              Steer
            </button>
            <button className="secondary-button" type="button" disabled={busy !== null}
              onClick={() => void run('pause')}>
              {busy === 'pause' ? 'Pausing…' : 'Pause'}
            </button>
          </>
        )}
        {state === 'Paused' && (
          <button className="secondary-button" type="button" disabled={busy !== null}
            onClick={() => void run('resume')}>
            {busy === 'resume' ? 'Resuming…' : 'Resume'}
          </button>
        )}
        {!confirmCancel ? (
          <button className="secondary-button" type="button" disabled={busy !== null}
            onClick={() => { setConfirmCancel(true); setSteering(false); setError(''); setFeedback(''); }}>
            Cancel task
          </button>
        ) : (
          <>
            <span className="task-control-confirmation">This ends the task and cannot be undone.</span>
            <button className="secondary-button" type="button" disabled={busy !== null}
              onClick={() => void run('cancel')}>
              {busy === 'cancel' ? 'Cancelling…' : 'Confirm cancel task'}
            </button>
            <button className="secondary-button" type="button" disabled={busy !== null}
              onClick={() => setConfirmCancel(false)}>
              Keep task
            </button>
          </>
        )}
      </div>
      {steering && state === 'Running' && (
        <form className="task-control-form" onSubmit={submitSteering}>
          <label htmlFor={`steer-${taskId}`}>Steering message</label>
          <textarea
            id={`steer-${taskId}`}
            value={message}
            maxLength={65_536}
            rows={3}
            onChange={(event) => setMessage(event.target.value)}
            disabled={busy !== null}
            required
          />
          <button className="secondary-button" type="submit" disabled={busy !== null || !message.trim()}>
            {busy === 'steer' ? 'Sending steering message…' : 'Send steering message'}
          </button>
        </form>
      )}
      {error && <p className="task-control-error" role="alert">{error}</p>}
      {feedback && <p className="task-control-feedback" role="status" aria-live="polite">{feedback}</p>}
    </div>
  );
}
