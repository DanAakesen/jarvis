import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ContextPanelContext, useContextPanel } from './context-panel-state';
import type { ContextPanelContent, ContextPanelReturnFocus } from './context-panel-state';
import { GeneratedViewRenderer } from './GeneratedViewRenderer';
import { StateMessage } from './StateMessage';
import { isTopModal, useModalLifecycle } from './useModalLifecycle';

const emptyContext: ContextPanelContent = { title: 'Context', status: 'empty' };

export function ContextPanelProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ContextPanelContent>(emptyContext);
  const [isOpen, setIsOpen] = useState(false);
  const returnFocusTarget = useRef<ContextPanelReturnFocus>(null);

  const close = useCallback(() => {
    if (typeof document !== 'undefined' &&
        document.getElementById('context-panel')?.contains(document.activeElement)) {
      const target = typeof returnFocusTarget.current === 'function' ? returnFocusTarget.current() : returnFocusTarget.current;
      (target?.isConnected ? target : document.getElementById('context-panel-toggle'))?.focus();
    }
    returnFocusTarget.current = null;
    setIsOpen(false);
  }, []);

  const show = useCallback((nextContent: ContextPanelContent, returnFocus?: ContextPanelReturnFocus) => {
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

export function ContextPanel({ closeIcon, resizeHandle, modal = false }: { closeIcon: ReactNode; resizeHandle?: ReactNode; modal?: boolean }) {
  const { content, isOpen, close } = useContextPanel();
  const panel = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const pressStartedOutside = useRef(false);
  const edited = useRef(false);
  useEffect(() => { if (!isOpen) edited.current = false; }, [isOpen]);
  const dismiss = () => { if (!edited.current && isTopModal(panel.current)) close(); };
  const { onKeyDown } = useModalLifecycle({ active: modal && isOpen, dialog: panel, boundary: modal ? backdrop : panel, onDismiss: dismiss });
  const message = content.status === 'empty'
    ? content.message ?? 'No relevant information.'
    : content.status === 'loading'
      ? content.message ?? 'Loading contextual information…'
      : content.status === 'view' || content.status === 'custom'
        ? undefined
        : content.message;

  const contentPanel = (
    <aside
      ref={panel}
      id="context-panel"
      className="context-panel"
      hidden={!isOpen && !modal}
      aria-labelledby="context-heading"
      role={modal ? 'dialog' : undefined}
      aria-modal={modal ? true : undefined}
      tabIndex={modal ? -1 : undefined}
      onKeyDown={modal ? onKeyDown : undefined}
      onInputCapture={() => { edited.current = true; }}
      onChangeCapture={() => { edited.current = true; }}
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
            ? <StateMessage variant="loading" message={message ?? 'Loading contextual information.'} />
            : content.status === 'error'
              ? <StateMessage variant="error" message={message ?? 'Contextual information could not be loaded.'} />
              : <p>{message}</p>}
      </div>
      {resizeHandle}
    </aside>
  );
  return modal ? (
    <div ref={backdrop} className="context-panel-modal-backdrop" hidden={!isOpen} inert={!isOpen}
      onPointerDown={(event) => { pressStartedOutside.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressStartedOutside.current) dismiss();
        pressStartedOutside.current = false;
      }}>
      {contentPanel}
    </div>
  ) : contentPanel;
}
