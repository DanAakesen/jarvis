import type { ReactNode } from 'react';
import { Loader, type LoaderVariant } from './Loader';

export type StateMessageVariant = 'loading' | 'empty' | 'error' | 'partial';

export function StateMessage({
  variant,
  message,
  loaderVariant = 'text',
  detail,
  mark,
  actionLabel,
  actionAriaLabel,
  actionDescribedBy,
  onAction,
  actionBusy = false,
  actionDisabled = false,
  actionClassName = 'secondary-button',
  className,
}: {
  variant: StateMessageVariant;
  message: string;
  loaderVariant?: LoaderVariant | undefined;
  detail?: ReactNode | undefined;
  mark?: ReactNode | undefined;
  actionLabel?: string | undefined;
  actionAriaLabel?: string | undefined;
  actionDescribedBy?: string | undefined;
  onAction?: (() => void) | undefined;
  actionBusy?: boolean | undefined;
  actionDisabled?: boolean | undefined;
  actionClassName?: string | undefined;
  className?: string | undefined;
}) {
  const extraClass = className ? ` ${className}` : '';
  const role = variant === 'error' ? 'alert' : 'status';

  return (
    <div className={`state-message state-message--${variant}${extraClass}`} role={role}
      aria-live={variant === 'error' ? undefined : 'polite'}>
      {mark && <span className="state-message-mark" aria-hidden="true">{mark}</span>}
      {variant === 'loading'
        ? <>
          {loaderVariant === 'text'
            ? <div className="state-message-loading">
              <p className="state-message-copy">{message}</p>
              <span aria-hidden="true">
                <Loader variant="text" size="inline" text="" label="" announce={false} className="state-message-loader" />
              </span>
            </div>
            : <>
              <p className="state-message-copy">{message}</p>
              <span className="state-message-skeleton" aria-hidden="true">
                <Loader variant={loaderVariant} label="" announce={false} className="state-message-loader" />
              </span>
            </>}
        </>
        : <p className="state-message-copy">{message}</p>}
      {detail && <p className="state-message-detail">{detail}</p>}
      {actionLabel && onAction && (
        <div className="button-group state-message-actions">
          <button className={actionClassName} type="button" onClick={onAction}
            disabled={actionBusy || actionDisabled || undefined} aria-busy={actionBusy || undefined}
            aria-label={actionAriaLabel} aria-describedby={actionDescribedBy}>
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
