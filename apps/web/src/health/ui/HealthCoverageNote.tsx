import type { ReactNode } from 'react';

export function HealthCoverageNote({ summary, children }: { summary: string; children: ReactNode }) {
  return <details className="health-coverage-note">
    <summary>{summary}</summary>
    <div className="health-coverage-note-content">{children}</div>
  </details>;
}
