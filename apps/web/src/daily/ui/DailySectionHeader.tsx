import type { ReactNode } from 'react';
import type { Ref } from 'react';

export function DailySectionHeader({ title, actions, controls, freshness, aboutData, headingRef, headingId, headingTabIndex = -1 }: {
  title?: string;
  actions?: ReactNode;
  controls?: ReactNode;
  freshness?: ReactNode;
  aboutData?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  headingId?: string;
  headingTabIndex?: number | null;
}) {
  return <>
    {title && <header className="daily-section-header">
      <div className="daily-section-header-content">
        <h2 id={headingId} ref={headingRef} {...(headingTabIndex === null ? {} : { tabIndex: headingTabIndex })}>{title}</h2>
      </div>
    </header>}
    {controls}
    {actions && <div className="daily-section-actions">{actions}</div>}
    {freshness}
    {aboutData}
  </>;
}
