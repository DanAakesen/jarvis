import type { ReactNode } from 'react';

export function ScrollTable({ label, stickyFirstColumn = false, children }: {
  label: string;
  stickyFirstColumn?: boolean;
  children: ReactNode;
}) {
  return <div className={`daily-scroll-table${stickyFirstColumn ? ' daily-scroll-table-sticky' : ''}`}
    role="region" aria-label={label} tabIndex={0}>
    {children}
  </div>;
}
