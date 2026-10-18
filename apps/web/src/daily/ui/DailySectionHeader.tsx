import type { ReactNode } from 'react';
import type { Ref } from 'react';

export function DailySectionHeader({ title, actions, headingRef, headingId }: {
  title: string;
  actions?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  headingId?: string;
}) {
  return <header className="daily-section-header">
    <h2 id={headingId} ref={headingRef} tabIndex={-1}>{title}</h2>
    {actions && <div className="daily-section-actions">{actions}</div>}
  </header>;
}
