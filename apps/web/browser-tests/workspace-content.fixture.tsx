import { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { GeneratedView } from '@jarvis/contracts';
import { Workspace, type WorkspaceView } from '../src/Workspace';
import '../src/styles.css';

const exactLongLine = `Long synthetic identifier: ${'workspace_identifier_segment_'.repeat(8)}`;
const codeView = {
  version: 1,
  title: 'Synthetic README',
  renderer: 'code',
  source: { id: 'factory.tasks', status: 'complete', updatedAt: '2026-10-25T12:00:00.000Z' },
  data: {
    repo: 'DanAakesen/jarvis',
    path: 'README.md',
    ref: 'synthetic',
    language: 'markdown',
    content: [
      '# Synthetic README',
      'A prose paragraph should wrap naturally inside a narrow workspace window without losing its words or punctuation.',
      exactLongLine,
      `Long URL: https://example.test/${'deeply/nested/repository/path/'.repeat(6)}?query=${'readable-'.repeat(8)}`,
      'Exact selection sample.',
      'Highlighted README range remains readable.',
    ].join('\n'),
    startLine: 1,
    highlight: [{ from: 6, to: 6 }],
    query: 'README',
  },
} as unknown as GeneratedView;

const tableView = {
  version: 1,
  title: 'Wide synthetic table',
  renderer: 'table',
  source: { id: 'factory.tasks', status: 'complete', updatedAt: '2026-10-25T12:00:00.000Z' },
  data: {
    columns: Array.from({ length: 10 }, (_, index) => `Long column heading ${index + 1}`),
    rows: Array.from({ length: 4 }, (_, row) => Array.from(
      { length: 10 },
      (_, column) => `row-${row + 1}-column-${column + 1}-${'complete-cell-value-'.repeat(2)}`,
    )),
  },
} as unknown as GeneratedView;

const chartLabels = Array.from({ length: 12 }, (_, index) => (
  `${[
    'Autumn harvest observation with a long category label',
    'Winter planning observation with another long category label',
    'Spring readiness observation with a third long category label',
  ][index % 3]} (${index + 1})`
));
const chartView = {
  version: 1,
  title: 'Long-label chart',
  renderer: 'chart',
  source: { id: 'factory.tasks', status: 'complete', updatedAt: '2026-10-25T12:00:00.000Z' },
  data: {
    kind: 'bar',
    series: [{ name: 'Synthetic values', points: chartLabels.map((label, index) => ({ x: label, y: (index + 1) * 12 })) }],
  },
} as unknown as GeneratedView;

const definitions = [
  { id: 'readme', title: 'Synthetic README', view: codeView },
  { id: 'table', title: 'Wide synthetic table', view: tableView },
  { id: 'chart', title: 'Long-label chart', view: chartView },
] as const;

function App() {
  const [openIds, setOpenIds] = useState<string[]>(definitions.map(({ id }) => id));
  const [narrow, setNarrow] = useState(false);
  const [dark, setDark] = useState(false);
  const [tabsHost, setTabsHost] = useState<HTMLDivElement | null>(null);
  const callbackRefs = useRef(new Map<string, () => void>());
  const views = useMemo(() => definitions
    .filter(({ id }) => openIds.includes(id))
    .map(({ id, title, view }): WorkspaceView => {
      let onClose = callbackRefs.current.get(id);
      if (!onClose) {
        onClose = () => setOpenIds((current) => current.filter((candidate) => candidate !== id));
        callbackRefs.current.set(id, onClose);
      }
      return { id, title, content: { status: 'generated', view }, onClose };
    }), [openIds]);

  return (
    <div className="workspace-browser-fixture" data-testid="workspace-browser-fixture">
      <header className="workspace-browser-fixture-controls" aria-label="Synthetic fixture controls">
        <button type="button" className="secondary-button" data-testid="constrain-workspace" onClick={() => setNarrow(true)}>
          Constrain workspace to 520px
        </button>
        <button type="button" className="secondary-button" data-testid="expand-workspace" onClick={() => setNarrow(false)}>
          Use full workspace width
        </button>
        <button type="button" className="secondary-button" data-testid="toggle-theme" aria-pressed={dark}
          onClick={() => {
            setDark((current) => {
              const next = !current;
              document.documentElement.dataset.theme = next ? 'dark' : 'light';
              return next;
            });
          }}>
          {dark ? 'Use light theme' : 'Use dark theme'}
        </button>
        {definitions.map(({ id, title }) => (
          <button key={id} type="button" className="secondary-button" data-testid={`reopen-${id}`}
            onClick={() => setOpenIds((current) => current.includes(id) ? current : [...current, id])}>
            Reopen {title}
          </button>
        ))}
      </header>
      <div ref={setTabsHost} className="workspace-browser-fixture-tabs" />
      <main className={`workspace-browser-fixture-stage${narrow ? ' workspace-browser-fixture-stage--narrow' : ''}`}>
        <Workspace views={views} tabsHost={tabsHost} />
      </main>
    </div>
  );
}

const fixtureStyles = document.createElement('style');
fixtureStyles.textContent = `
  html, body, #root { width: 100%; min-width: 0; min-height: 100%; margin: 0; }
  .workspace-browser-fixture { box-sizing: border-box; display: flex; min-height: 100dvh; flex-direction: column; }
  .workspace-browser-fixture-controls { display: flex; min-width: 0; flex: 0 0 auto; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px; }
  .workspace-browser-fixture-controls .secondary-button { min-height: 36px; padding-inline: 8px; font-size: 12px; }
  .workspace-browser-fixture-tabs { min-width: 0; flex: 0 0 auto; }
  .workspace-browser-fixture-stage { width: 100%; min-width: 0; min-height: 0; flex: 1 1 auto; }
  .workspace-browser-fixture-stage--narrow { width: min(520px, 100%); }
  .workspace-browser-fixture-stage > .workspace { box-sizing: border-box; min-width: 0; min-height: 0; margin: 0; }
  @media (max-width: 700px) {
    .workspace-browser-fixture-stage > .workspace { height: 100%; }
    .workspace-browser-fixture-stage--narrow { width: 100%; }
  }
`;
document.head.append(fixtureStyles);

createRoot(document.getElementById('root')!).render(<App />);
