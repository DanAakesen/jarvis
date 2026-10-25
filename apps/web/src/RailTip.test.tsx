import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRailTip } from './RailTip';

function Harness() {
  const { railTipProps, railTip } = useRailTip();
  return (
    <>
      <nav aria-label="Areas" {...railTipProps}>
        <a href="#home" data-rail-tip="Jarvis" aria-label="Conversation">Home</a>
        <button type="button" data-rail-tip="Workspaces">Workspaces</button>
        <button type="button">Unlabelled</button>
      </nav>
      <button type="button">Outside</button>
      {railTip}
    </>
  );
}

const tip = () => document.body.querySelector<HTMLElement>('.rail-tip')!;
const folio = () => screen.getByRole('button', { name: 'Workspaces' });
const mouse = { pointerType: 'mouse' };

afterEach(cleanup);

describe('rail label', () => {
  it('starts closed, outside the rail and hidden from assistive technology', () => {
    render(<Harness />);
    expect(tip().parentElement).toBe(document.body);
    expect(tip().getAttribute('data-open')).toBe('false');
    expect(tip().getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the control name on hover and closes when the pointer leaves the rail', () => {
    render(<Harness />);
    fireEvent.pointerOver(folio(), mouse);
    expect(tip().textContent).toBe('Workspaces');
    expect(tip().getAttribute('data-open')).toBe('true');
    fireEvent.pointerOut(folio(), { ...mouse, relatedTarget: screen.getByRole('button', { name: 'Outside' }) });
    expect(tip().getAttribute('data-open')).toBe('false');
  });

  it('swaps the name when the pointer moves between rail controls without closing', () => {
    render(<Harness />);
    const home = screen.getByRole('link', { name: 'Conversation' });
    fireEvent.pointerOver(home, mouse);
    expect(tip().textContent).toBe('Jarvis');
    fireEvent.pointerOut(home, { ...mouse, relatedTarget: folio() });
    expect(tip().getAttribute('data-open')).toBe('true');
    fireEvent.pointerOver(folio(), mouse);
    expect(tip().textContent).toBe('Workspaces');
    expect(tip().getAttribute('data-open')).toBe('true');
  });

  it('stays open while the pointer travels onto the label and closes when it leaves it', () => {
    render(<Harness />);
    fireEvent.pointerOver(folio(), mouse);
    fireEvent.pointerOut(folio(), { ...mouse, relatedTarget: tip() });
    expect(tip().getAttribute('data-open')).toBe('true');
    fireEvent.pointerOut(tip(), { ...mouse, relatedTarget: screen.getByRole('button', { name: 'Outside' }) });
    expect(tip().getAttribute('data-open')).toBe('false');
  });

  it('ignores touch and controls without a name', () => {
    render(<Harness />);
    fireEvent.pointerOver(folio(), { pointerType: 'touch' });
    expect(tip().getAttribute('data-open')).toBe('false');
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Unlabelled' }), mouse);
    expect(tip().getAttribute('data-open')).toBe('false');
  });

  it('shows on keyboard focus and closes on blur', async () => {
    const matches = Element.prototype.matches;
    // jsdom never reports :focus-visible, so stand in for a keyboard-driven focus.
    const spy = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' ? true : matches.call(this, selector);
    });
    try {
      const user = userEvent.setup();
      render(<Harness />);
      await user.tab();
      await user.tab();
      expect(document.activeElement).toBe(folio());
      expect(tip().textContent).toBe('Workspaces');
      expect(tip().getAttribute('data-open')).toBe('true');
      await user.tab();
      await user.tab();
      expect(tip().getAttribute('data-open')).toBe('false');
    } finally {
      spy.mockRestore();
    }
  });

  it('closes when a focused control is activated from the keyboard', async () => {
    const matches = Element.prototype.matches;
    const spy = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' ? true : matches.call(this, selector);
    });
    try {
      const user = userEvent.setup();
      render(<Harness />);
      await user.tab();
      await user.tab();
      expect(document.activeElement).toBe(folio());
      expect(tip().getAttribute('data-open')).toBe('true');
      await user.keyboard('{Enter}');
      expect(tip().getAttribute('data-open')).toBe('false');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the label closed when focus came from a pointer', () => {
    render(<Harness />);
    fireEvent.pointerOver(folio(), mouse);
    act(() => { folio().focus(); });
    expect(tip().getAttribute('data-open')).toBe('false');
  });

  it('can be dismissed with Escape, by pressing the control and by resizing', () => {
    render(<Harness />);
    fireEvent.pointerOver(folio(), mouse);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tip().getAttribute('data-open')).toBe('false');

    fireEvent.pointerOver(folio(), mouse);
    fireEvent.pointerDown(folio(), mouse);
    expect(tip().getAttribute('data-open')).toBe('false');

    fireEvent.pointerOver(folio(), mouse);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(tip().getAttribute('data-open')).toBe('false');
  });
});
