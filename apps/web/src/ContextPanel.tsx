import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { ContextPanelContext, useContextPanel } from './context-panel-state';
import type { ContextPanelContent } from './context-panel-state';
import { GeneratedViewRenderer } from './GeneratedViewRenderer';

const emptyContext: ContextPanelContent = { title: 'Context', status: 'empty' };

export function ContextPanelProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ContextPanelContent>(emptyContext);
  const [isOpen, setIsOpen] = useState(false);

  const close = useCallback(() => {
    if (typeof document !== 'undefined' &&
        document.getElementById('context-panel')?.contains(document.activeElement)) {
      document.getElementById('context-panel-toggle')?.focus();
    }
    setIsOpen(false);
  }, []);

  const show = useCallback((nextContent: ContextPanelContent) => {
    setContent(nextContent);
    setIsOpen(true);
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      setIsOpen(true);
    }
  }, [close, isOpen]);

  return (
    <ContextPanelContext.Provider value={{
      content,
      isOpen,
      close,
      show,
      toggle,
    }}>
      {children}
    </ContextPanelContext.Provider>
  );
}

export function ContextPanel({ closeIcon }: { closeIcon: ReactNode }) {
  const { content, isOpen, close } = useContextPanel();
  const message = content.status === 'empty'
    ? content.message ?? 'No relevant information is available yet.'
    : content.status === 'loading'
      ? content.message ?? 'Loading contextual information…'
      : content.status === 'view'
        ? undefined
        : content.message;

  return (
    <aside
      id="context-panel"
      className="context-panel"
      hidden={!isOpen}
      aria-labelledby="context-heading"
    >
      <div className="context-panel-heading">
        <h2 id="context-heading">{content.title}</h2>
        <button className="sidebar-close" type="button" aria-label="Close context panel" onClick={close}>
          {closeIcon}
        </button>
      </div>
      {content.status === 'view'
        ? (
          <GeneratedViewRenderer
            view={content.view}
            {...(content.trustedBlobHost ? { trustedBlobHost: content.trustedBlobHost } : {})}
          />
        )
        : content.status === 'loading'
          ? <p role="status">{message}</p>
          : content.status === 'error'
            ? <p role="alert">{message}</p>
            : <p>{message}</p>}
    </aside>
  );
}
