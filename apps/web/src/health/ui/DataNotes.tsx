import type { ReactNode } from 'react';

export function DataNotes({ children }: { children: ReactNode }) {
  return <details className="health-data-notes">
    <summary>About this data</summary>
    <div>{children}</div>
  </details>;
}
