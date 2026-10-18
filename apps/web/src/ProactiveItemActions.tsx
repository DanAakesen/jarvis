import { useState } from 'react';
import { copenhagenClock, tomorrowAtSeven, type ItemAction, type ProactiveItem } from './proactive-data';

type Action = (item: ProactiveItem, action: ItemAction, snoozeUntil?: string) => Promise<void>;

export function ItemActionControls({ item, now, onAction }: {
  item: ProactiveItem;
  now: number;
  onAction: Action;
}) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ action: ItemAction; snoozeUntil?: string } | null>(null);

  const apply = async (action: ItemAction, snoozeUntil?: string) => {
    setPending(true);
    setFailure(null);
    try {
      await onAction(item, action, snoozeUntil);
    } catch {
      setFailure({ action, ...(snoozeUntil ? { snoozeUntil } : {}) });
    } finally {
      setPending(false);
    }
  };

  const snoozeOptions = [
    { label: 'In 1 hour', at: new Date(now + 60 * 60_000) },
    { label: 'In 4 hours', at: new Date(now + 4 * 60 * 60_000) },
    { label: 'Tomorrow 07:00 Europe/Copenhagen', at: tomorrowAtSeven(now) },
  ].filter(({ at }) => at.getTime() > now && at.getTime() - now <= 7 * 24 * 60 * 60_000);

  return <div className="proactive-item-actions">
    <button className="secondary-button" type="button" disabled={pending}
      aria-label={`Dismiss ${item.title}`} onClick={() => { void apply('dismiss'); }}>Dismiss</button>
    <details className="proactive-snooze">
      <summary aria-label={`Snooze ${item.title}`} aria-disabled={pending}>Snooze</summary>
      <div className="proactive-snooze-menu" role="group" aria-label={`Snooze ${item.title}`}>
        {snoozeOptions.map(({ label, at }) => <button key={label} className="secondary-button" type="button" disabled={pending}
          aria-label={`Snooze ${item.title} ${label}`} onClick={(event) => {
            const until = at.toISOString();
            void apply('snooze', until);
            (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
          }}>{label}<span className="proactive-snooze-time">{copenhagenClock(at.toISOString())}</span></button>)}
      </div>
    </details>
    <button className="secondary-button" type="button" disabled={pending} aria-pressed={item.feedback === 'useful'}
      aria-label={`Useful ${item.title}`} onClick={() => { void apply('useful'); }}>
      Useful{item.feedback === 'useful' ? ' (selected)' : ''}
    </button>
    <button className="secondary-button" type="button" disabled={pending} aria-pressed={item.feedback === 'wrong'}
      aria-label={`Wrong ${item.title}`} onClick={() => { void apply('wrong'); }}>
      Wrong{item.feedback === 'wrong' ? ' (selected)' : ''}
    </button>
    {failure && <p className="proactive-action-error" role="alert">
      Could not update this item. Try again.
      <button className="secondary-button" type="button" disabled={pending}
        onClick={() => { void apply(failure.action, failure.snoozeUntil); }}>Retry</button>
    </p>}
  </div>;
}
