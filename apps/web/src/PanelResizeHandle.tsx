import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

/** A centred grab handle on a shell panel's inner edge; drag or use arrow keys to change the panel width. */
export function PanelResizeHandle({ edge, label, width, min, max, onChange }: {
  /** Which side of the panel the handle sits on; dragging toward the screen centre widens the panel. */
  edge: 'right' | 'left';
  label: string;
  width: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
}) {
  const gesture = useRef<{ id: number; startX: number; startWidth: number } | null>(null);
  const clamp = (value: number) => Math.round(Math.min(max, Math.max(min, value)));
  const direction = edge === 'right' ? 1 : -1;

  function begin(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    // Start from the rendered column width (layout size plus slab margins), so the panel never jumps on grab.
    const panel = event.currentTarget.parentElement;
    const styles = panel ? getComputedStyle(panel) : null;
    const rendered = panel && styles
      ? panel.offsetWidth + (parseFloat(styles.marginLeft) || 0) + (parseFloat(styles.marginRight) || 0)
      : width;
    gesture.current = { id: event.pointerId, startX: event.clientX, startWidth: rendered || width };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.documentElement.dataset.panelResizing = 'true';
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    onChange(clamp(current.startWidth + (event.clientX - current.startX) * direction));
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current = null;
    delete document.documentElement.dataset.panelResizing;
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16;
    const next = event.key === 'Home' ? min
      : event.key === 'End' ? max
        : event.key === 'ArrowRight' ? width + step * direction
          : event.key === 'ArrowLeft' ? width - step * direction
            : null;
    if (next === null) return;
    event.preventDefault();
    onChange(clamp(next));
  }

  return (
    <div
      className={`panel-resize-handle panel-resize-handle-${edge}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      title={`${label} (drag or use arrow keys)`}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={keyDown}
    >
      <span aria-hidden="true" />
    </div>
  );
}
