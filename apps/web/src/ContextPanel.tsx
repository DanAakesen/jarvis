import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ContextPanelContext, useContextPanel } from './context-panel-state';
import type { ContextPanelContent } from './context-panel-state';
import { GeneratedViewRenderer } from './GeneratedViewRenderer';
import { Loader } from './Loader';

const emptyContext: ContextPanelContent = { title: 'Context', status: 'empty' };

export function ContextPanelProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ContextPanelContent>(emptyContext);
  const [isOpen, setIsOpen] = useState(false);
  const returnFocusTarget = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    if (typeof document !== 'undefined' &&
        document.getElementById('context-panel')?.contains(document.activeElement)) {
      const target = returnFocusTarget.current;
      (target?.isConnected ? target : document.getElementById('context-panel-toggle'))?.focus();
    }
    returnFocusTarget.current = null;
    setIsOpen(false);
  }, []);

  const show = useCallback((nextContent: ContextPanelContent, returnFocus?: HTMLElement | null) => {
    setContent(nextContent);
    returnFocusTarget.current = returnFocus ?? null;
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

export function ContextPanel({ closeIcon, resizeHandle }: { closeIcon: ReactNode; resizeHandle?: ReactNode }) {
  const { content, isOpen, close } = useContextPanel();
  const message = content.status === 'empty'
    ? content.message ?? 'No relevant information.'
    : content.status === 'loading'
      ? content.message ?? 'Loading contextual information…'
      : content.status === 'view' || content.status === 'custom'
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
      <div className="context-panel-body">
      {content.status === 'view'
        ? (
          <GeneratedViewRenderer
            view={content.view}
            {...(content.trustedBlobHost ? { trustedBlobHost: content.trustedBlobHost } : {})}
          />
        )
        : content.status === 'custom'
          ? isOpen ? content.content : null
          : content.status === 'loading'
            ? <Loader variant="lines" label={message ?? 'Loading contextual information…'} />
            : content.status === 'error'
              ? <p role="alert">{message}</p>
              : <p>{message}</p>}
      </div>
      {resizeHandle}
    </aside>
  );
}
