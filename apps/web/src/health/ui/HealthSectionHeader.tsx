import type { ReactNode } from 'react';
import type { Ref } from 'react';

export function HealthSectionHeader({ title, actions, controls, freshness, aboutData, headingRef, headingId, headingTabIndex = -1 }: {
  title?: string;
  actions?: ReactNode;
  controls?: ReactNode;
  freshness?: ReactNode;
  aboutData?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  headingId?: string;
  headingTabIndex?: number | null;
}) {
  const actionBar = actions && <div className="health-section-actions">{actions}</div>;
  return <>
    {title ? <header className="health-section-header">
      <div className="health-section-header-content">
        <h2 id={headingId} ref={headingRef} {...(headingTabIndex === null ? {} : { tabIndex: headingTabIndex })}>{title}</h2>
      </div>
      {actionBar}
    </header> : actionBar}
    {controls}
    {freshness}
    {aboutData}
  </>;
}
