import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationMoreMenu } from './ConversationMoreMenu';
import type { VoiceLanguage } from './voice-client';

function Harness({ onSelect = vi.fn(), disabled = false }: { onSelect?: () => void; disabled?: boolean }) {
  const [language, setLanguage] = useState<VoiceLanguage>('en');
  return (
    <>
      <ConversationMoreMenu
        language={language}
        onLanguageChange={setLanguage}
        actions={[{
          id: 'mute',
          label: 'Mute microphone',
          icon: <svg aria-hidden="true" />,
          onSelect,
          disabled,
          ...(disabled ? { description: 'Available once the voice session is connected.' } : {}),
        }]}
      />
      <button type="button">Outside</button>
      <output aria-label="Current language">{language}</output>
    </>
  );
}

describe('ConversationMoreMenu', () => {
  it('opens a Language flyout with Danish and English and a checked current choice', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'More options' });

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'More options' });
    expect(menu.classList.contains('luminous-glass')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Language' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Language' }));
    expect(screen.getByRole('menu', { name: 'Language' })).not.toBeNull();
    expect(screen.getByRole('menuitemradio', { name: 'Danish' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('menuitemradio', { name: 'English' }).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'English' }));

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Danish' }));
    expect(screen.getByRole('status', { name: 'Current language' }).textContent).toBe('da');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Language' }));
    expect(screen.getByRole('menuitemradio', { name: 'Danish' }).getAttribute('aria-checked')).toBe('true');
  });

  it('supports arrow keys and closes the flyout, then the menu, with Escape', () => {
    const outerEscape = vi.fn();
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') outerEscape();
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'More options' });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const language = screen.getByRole('menuitem', { name: 'Language' });
    expect(document.activeElement).toBe(language);
    fireEvent.keyDown(language, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Mute microphone' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(language);

    fireEvent.keyDown(language, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'English' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Danish' }));

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Language' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'More options' })).not.toBeNull();
    expect(document.activeElement).toBe(language);

    fireEvent.keyDown(language, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(outerEscape).not.toHaveBeenCalled();
    document.removeEventListener('keydown', onDocumentKeyDown);
  });

  it('closes on an outside pointer and when focus leaves the menu', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'More options' });

    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    fireEvent.blur(screen.getByRole('menuitem', { name: 'Language' }), {
      relatedTarget: screen.getByRole('button', { name: 'Outside' }),
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('runs available actions and explains unavailable ones without running them', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<Harness onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mute microphone' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();

    rerender(<Harness onSelect={onSelect} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    const item = screen.getByRole('menuitem', { name: 'Mute microphone' });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe('Available once the voice session is connected.');
    expect(document.getElementById(item.getAttribute('aria-describedby')!)?.textContent)
      .toBe('Available once the voice session is connected.');
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menu', { name: 'More options' })).not.toBeNull();
  });
});
