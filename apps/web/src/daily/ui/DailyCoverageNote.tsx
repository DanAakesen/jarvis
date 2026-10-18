import type { ReactNode } from 'react';

export function DailyCoverageNote({ summary, children }: { summary: string; children: ReactNode }) {
  return <details className="daily-coverage-note">
    <summary>{summary}</summary>
    <div className="daily-coverage-note-content">{children}</div>
  </details>;
}
