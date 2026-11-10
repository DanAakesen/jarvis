import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { FeedAttention, ActivityItem } from './activity';
import { activityHref } from './activity';
import { formatDateTime } from './format/date-time';
import { ShellIcon } from './ShellIcon';
import { returnFocusAfterOutsidePress } from './overlay-focus';
import { useOverlayMotion } from './overlay-motion';

function without<T>(values: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(values);
  next.delete(value);
  return next;
}

function AttentionItems({
  items,
  onDismiss,
  panel,
}: {
  items: readonly ActivityItem[];
  onDismiss?: FeedAttention['onDismiss'];
  panel: RefObject<HTMLDivElement | null>;
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  async function dismiss(item: ActivityItem) {
    if (!onDismiss || pending.has(item.id)) return;
    setPending((current) => new Set(current).add(item.id));
    setFailed((current) => without(current, item.id));
    try {
      await onDismiss(item.id);
      setDismissed((current) => new Set(current).add(item.id));
      panel.current?.focus();
    } catch {
      setFailed((current) => new Set(current).add(item.id));
    } finally {
      setPending((current) => without(current, item.id));
    }
  }

  const visible = items.filter((item) => !dismissed.has(item.id));
  if (visible.length === 0) return null;
  return (
    <section aria-labelledby="attention-items-heading">
      <h3 id="attention-items-heading">Activity</h3>
      {!onDismiss && <p id="attention-dismiss-unavailable">Dismiss is unavailable.</p>}
      <ul className="activity-list">
        {visible.map((item) => {
          const href = activityHref(item.link);
          const busy = pending.has(item.id);
          return (
            <li key={item.id} className="activity-item">
              <div>
                {href ? <Link className="activity-title" to={href}>{item.title}</Link>
                  : <span className="activity-title">{item.title}</span>}
                <p className="activity-time"><time dateTime={item.at}>{formatDateTime(item.at)}</time></p>
                {failed.has(item.id) && (
                  <p className="error-text" role="alert">Jarvis could not dismiss this item. Try again.</p>
                )}
              </div>
              <button className="secondary-button attention-dismiss" type="button"
                aria-label={`${busy ? 'Dismissing' : 'Dismiss'} ${item.title}`}
                aria-describedby={onDismiss ? undefined : 'attention-dismiss-unavailable'}
                disabled={!onDismiss || busy} onClick={() => { void dismiss(item); }}>
                {busy ? 'Dismissing…' : 'Dismiss'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function focusHeaderFallback() {
  const focus = () => {
    // The frame can land after something else took focus (a newer popover, a deliberate click); only rescue focus that fell to the page.
    if (document.activeElement && document.activeElement !== document.body) return;
    // Narrow phones hide the presence chip and the Settings link, and focusing a hidden control does nothing, so take the first control that accepts focus.
    for (const selector of ['.jobs-summary', '.presence-chip-trigger', '.mobile-menu-button', '.settings-link']) {
      const target = document.querySelector<HTMLElement>(selector);
      target?.focus();
      if (target && document.activeElement === target) return;
    }
  };
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focus);
  else focus();
}

export function AttentionPopover({ attention }: { attention: FeedAttention | null }) {
  const count = attention?.items.length ?? 0;
  return count > 0 && attention ? <AttentionPopoverContent attention={attention} count={count} /> : null;
}

function AttentionPopoverContent({ attention, count }: { attention: FeedAttention; count: number }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const popoverRef = useOverlayMotion(popover, 'menu');
  const popoverId = useId();
  const label = `${count} ${count === 1 ? 'item needs' : 'items need'} attention`;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        if (root.current?.contains(document.activeElement)) returnFocusAfterOutsidePress(trigger.current);
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    const activeTrigger = trigger.current;
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      if (!activeTrigger?.isConnected) focusHeaderFallback();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => popover.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [open]);

  function close() {
    setOpen(false);
    if (count > 0 && trigger.current?.isConnected) trigger.current.focus();
  }

  return (
    <div ref={root} className="attention-chip" onKeyDown={(event) => {
      if (event.key !== 'Escape' || !open) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    }}>
      {count > 0 && (
        <button ref={trigger} type="button" className="workspace-tab jobs-summary attention-summary"
          aria-label={label} title={label} aria-expanded={open} aria-controls={popoverId}
          onClick={() => setOpen((current) => !current)}>
          <span className="jobs-outcome" data-status="attention" role="img" aria-label={label} title={label}>
            <ShellIcon name="attention" /><span aria-hidden="true">{count}</span>
          </span>
        </button>
      )}
      {open && count > 0 && attention && (
        <div ref={popoverRef} tabIndex={-1} id={popoverId} className="jobs-popover attention-popover"
          role="group" aria-label="Items needing attention">
          <div className="jobs-popover-heading">
            <span>Needs attention</span>
            <button type="button" className="workspace-tab-close" aria-label="Close attention"
              onClick={close}><ShellIcon name="close" /></button>
          </div>
          <AttentionItems items={attention.items} onDismiss={attention.onDismiss} panel={popover} />
        </div>
      )}
    </div>
  );
}
