import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PanelResizeHandle } from './PanelResizeHandle';
import { readPanelWidth, savePanelWidth } from './panel-width';

function Harness({ edge }: { edge: 'left' | 'right' }) {
  const [width, setWidth] = useState(240);
  return (
    <aside>
      <PanelResizeHandle edge={edge} label="Resize panel" width={width} min={160} max={420} onChange={setWidth} />
    </aside>
  );
}

describe('PanelResizeHandle', () => {
  it('is a keyboard-operable separator that widens toward the screen centre and stays within limits', () => {
    render(<Harness edge="right" />);
    const handle = screen.getByRole('separator', { name: 'Resize panel' });
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle.getAttribute('aria-valuenow')).toBe('256');
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    expect(handle.getAttribute('aria-valuenow')).toBe('208');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle.getAttribute('aria-valuenow')).toBe('420');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle.getAttribute('aria-valuenow')).toBe('420');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(handle.getAttribute('aria-valuenow')).toBe('160');
  });

  it('mirrors direction for a panel on the right side of the screen and follows a pointer drag', () => {
    render(<Harness edge="left" />);
    const handle = screen.getByRole('separator', { name: 'Resize panel' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle.getAttribute('aria-valuenow')).toBe('256');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 450 });
    expect(Number(handle.getAttribute('aria-valuenow'))).toBeGreaterThan(256);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 450 });
    expect(document.documentElement.dataset.panelResizing).toBeUndefined();
  });

  it('remembers only valid widths', () => {
    savePanelWidth('sidebar', 300);
    expect(readPanelWidth('sidebar', 160, 420)).toBe(300);
    localStorage.setItem('jarvis.shell.sidebarWidth', '9999');
    expect(readPanelWidth('sidebar', 160, 420)).toBeNull();
    localStorage.removeItem('jarvis.shell.sidebarWidth');
    expect(readPanelWidth('sidebar', 160, 420)).toBeNull();
  });
});
