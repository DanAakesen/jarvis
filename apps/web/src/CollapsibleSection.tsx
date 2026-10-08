import { useEffect, useId, useState, type ReactNode, type Ref } from 'react';

/**
 * A section that folds to its title (Dan, 8 October): the house pattern for settings-like pages, so long pages stay
 * short on a phone. The title is a button; a one-line summary shows the current state while folded. Each section
 * remembers whether it was open on this device. Sections start folded; without media queries (old browsers, tests)
 * everything starts open so nothing is hidden by surprise.
 */
const storagePrefix = 'jarvis.sections.';

function readOpen(key: string): boolean {
  const fallback = typeof window.matchMedia !== 'function';
  try {
    const stored = localStorage.getItem(storagePrefix + key);
    return stored === null ? fallback : stored === '1';
  } catch {
    return fallback;
  }
}

export function CollapsibleSection({ storageKey, title, headingId, summary, id, className, headerAside, toggleRef, children }: {
  /** Stable name for remembering the open state, e.g. `settings.voice`. */
  storageKey: string;
  title: string;
  /** Keeps existing heading ids, which navigation and the section tracker use. */
  headingId?: string;
  summary?: ReactNode;
  id?: string;
  className?: string;
  /** Small status shown at the end of the title row, e.g. a count. */
  headerAside?: ReactNode;
  /** Lets a section move focus to its title, e.g. after removing the focused item. */
  toggleRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  const generated = useId();
  const heading = headingId ?? `${generated}-heading`;
  const bodyId = `${heading}-body`;
  const [open, setOpen] = useState(() => readOpen(storageKey));
  useEffect(() => {
    try { localStorage.setItem(storagePrefix + storageKey, open ? '1' : '0'); } catch { /* storage may be blocked */ }
  }, [open, storageKey]);
  return (
    <section className={`settings-section collapsible-section${className ? ` ${className}` : ''}`} id={id}
      aria-labelledby={heading} data-collapsible="" data-open={open}>
      <h2 id={heading} className="collapsible-heading">
        <button ref={toggleRef} className="collapsible-toggle" type="button" aria-expanded={open} aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}>
          <span className="collapsible-title">{title}</span>
          {summary && !open && <span className="collapsible-summary">{summary}</span>}
          {headerAside && <span className="collapsible-aside">{headerAside}</span>}
          <svg className="collapsible-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m8 10 4 4 4-4" /></svg>
        </button>
      </h2>
      <div id={bodyId} className="collapsible-body" inert={!open}>
        <div className="collapsible-inner">{children}</div>
      </div>
    </section>
  );
}
