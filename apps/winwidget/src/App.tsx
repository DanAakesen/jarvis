import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { WidgetBridge } from '../electron/contract';

export function App() {
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState('');
  const reducedMotion = useReducedMotion();
  const bridge = window.jarvisWidget;

  async function act(action: (api: WidgetBridge) => Promise<void>) {
    if (!bridge || busy) return;
    setBusy(true);
    setError('');
    try { await action(bridge); }
    catch { setError('Window action failed. Try again.'); }
    finally { setBusy(false); }
  }

  return (
    <main className="widget" data-expanded={expanded}>
      <nav className="rail" aria-label="Window controls">
        <div className="drag-handle" title="Drag Jarvis to move the window" aria-label="Drag window">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h1m6 0h1M8 12h1m6 0h1M8 18h1m6 0h1" /></svg>
        </div>
        <button className="ghost-button" aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={expanded} aria-controls="sidebar" disabled={!bridge || busy}
          onClick={() => { void act(async api => { await api.setExpanded(!expanded); setExpanded(!expanded); }); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16m5-11 3 3-3 3" /></svg>
        </button>
        <div className="dock-controls">
          <button className="ghost-button" aria-label="Snap to left edge" title="Snap to left edge" disabled={!bridge || busy}
            onClick={() => { void act(async api => { await api.dock('left'); setPosition('Snapped to left edge.'); }); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14m14-7H9m4-4-4 4 4 4" /></svg>
          </button>
          <button className="ghost-button" aria-label="Snap to right edge" title="Snap to right edge" disabled={!bridge || busy}
            onClick={() => { void act(async api => { await api.dock('right'); setPosition('Snapped to right edge.'); }); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 5v14M5 12h10m-4-4 4 4-4 4" /></svg>
          </button>
        </div>
        <button className="ghost-button close-button" aria-label="Close widget" title="Close widget" disabled={!bridge || busy}
          onClick={() => { void act(api => api.close()); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      </nav>
      <motion.section id="sidebar" className="sidebar" aria-label="Companion scaffold"
        inert={!expanded} aria-hidden={!expanded} initial={false}
        animate={{ opacity: expanded ? 1 : 0, x: expanded || reducedMotion ? 0 : -12 }}
        transition={{ duration: reducedMotion ? 0 : 0.16, ease: 'easeOut' }}>
        <header className="drag-title"><h1>Jarvis</h1></header>
        <div className="placeholder">
          <p className="connection-state"><span aria-hidden="true" className="status-dot" />Not connected</p>
          <p>This Windows companion is a scaffold. There is no live backend connection.</p>
          <p>Features will be decided with Dan in a later interview.</p>
        </div>
        <p className="window-hint">Drag the top to move. Drop near either screen edge to snap.</p>
        {!bridge && <p className="feedback" role="status">Browser preview. Window controls require the Electron app.</p>}
      </motion.section>
      <p className="sr-only" role="status">{position}</p>
      {error && <p className="action-error" role="alert">{error}</p>}
    </main>
  );
}
