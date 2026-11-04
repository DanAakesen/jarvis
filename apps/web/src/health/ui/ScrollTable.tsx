import type { ReactNode } from 'react';

export function ScrollTable({ label, stickyFirstColumn = false, children }: {
  label: string;
  stickyFirstColumn?: boolean;
  children: ReactNode;
}) {
  return <div className={`health-scroll-table${stickyFirstColumn ? ' health-scroll-table-sticky' : ''}`}
    role="region" aria-label={label} tabIndex={0}>
    {children}
  </div>;
}
