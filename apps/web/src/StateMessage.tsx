import type { ReactNode } from 'react';
import { Loader } from './Loader';

export type StateMessageVariant = 'loading' | 'empty' | 'error' | 'partial';

export function StateMessage({
  variant,
  message,
  detail,
  mark,
  actionLabel,
  actionAriaLabel,
  onAction,
  actionBusy = false,
  actionClassName = 'secondary-button',
  className,
}: {
  variant: StateMessageVariant;
  message: string;
  detail?: string;
  mark?: ReactNode;
  actionLabel?: string;
  actionAriaLabel?: string;
  onAction?: () => void;
  actionBusy?: boolean;
  actionClassName?: string;
  className?: string;
}) {
  const extraClass = className ? ` ${className}` : '';
  const role = variant === 'error' ? 'alert' : 'status';

  return (
    <div className={`state-message state-message--${variant}${extraClass}`} role={role}
      aria-live={variant === 'error' ? undefined : 'polite'}>
      {mark && <span className="state-message-mark" aria-hidden="true">{mark}</span>}
      {variant === 'loading'
        ? <>
          <span aria-hidden="true">
            <Loader variant="text" size="inline" text={message} label={message} announce={false} className="state-message-loader" />
          </span>
          <span className="visually-hidden">{message}</span>
        </>
        : <p className="state-message-copy">{message}</p>}
      {detail && <p className="state-message-detail">{detail}</p>}
      {actionLabel && onAction && (
        <div className="button-group state-message-actions">
          <button className={actionClassName} type="button" onClick={onAction}
            disabled={actionBusy || undefined} aria-busy={actionBusy || undefined} aria-label={actionAriaLabel}>
            <span className="button-label">{actionLabel}</span>
            {actionBusy && (
              <span className="button-loading-indicator" aria-hidden="true">
                <Loader variant="inline" announce={false} label={`${actionLabel} in progress`} />
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
