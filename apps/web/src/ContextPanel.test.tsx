import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ContextPanel, ContextPanelProvider } from './ContextPanel';
import { useContextPanel } from './context-panel-state';

function PanelToggle() {
  const panel = useContextPanel();
  return <button id="context-panel-toggle" type="button" aria-label="Toggle contextual panel" onClick={panel.toggle}>Toggle panel</button>;
}

function AgentCommands() {
  const panel = useContextPanel();
  return (
    <div>
      <button type="button" onClick={() => panel.show({
        title: 'Research answer',
        status: 'ready',
        message: 'The answer is available without replacing the conversation.',
      })}>
        Jarvis shows an answer
      </button>
      <button type="button" onClick={() => panel.show({
        title: 'Source notes',
        status: 'ready',
        message: 'Updated source context.',
      })}>
        Jarvis changes context
      </button>
      <button type="button" onClick={() => panel.show({ title: 'Research answer', status: 'loading' })}>
        Jarvis loads context
      </button>
      <button type="button" onClick={() => panel.show({
        title: 'Research answer',
        status: 'error',
        message: 'The context could not be loaded.',
      })}>
        Jarvis reports a context error
      </button>
      <button id="task-selection" type="button" onClick={(event) => panel.show({
        title: 'Factory task',
        status: 'custom',
        content: <p>Task details stay in the shared panel.</p>,
      }, event.currentTarget)}>
        Select Factory task
      </button>
      <button type="button" onClick={panel.close}>Jarvis closes the panel</button>
      <button type="button" onClick={() => panel.close()}>Close while focus is outside the panel</button>
      <button type="button" onClick={() => act(() => panel.close())}>Close by command</button>
    </div>
  );
}

function renderPanel() {
  return render(
    <ContextPanelProvider>
      <main><h1>Main conversation</h1></main>
      <PanelToggle />
      <ContextPanel closeIcon={<span aria-hidden="true">×</span>} />
      <AgentCommands />
    </ContextPanelProvider>,
  );
}

describe('ContextPanel', () => {
  it('keeps edited mobile content on implicit dismissal and resets protection after close', async () => {
    const user = userEvent.setup();
    function EditableContext() {
      const panel = useContextPanel();
      return <button type="button" onClick={() => panel.show({
        title: 'Edit context', status: 'custom', content: <label>Context note<input /></label>,
      })}>Edit context</button>;
    }
    render(<ContextPanelProvider><EditableContext /><ContextPanel modal closeIcon="×" /></ContextPanelProvider>);
    await user.click(screen.getByRole('button', { name: 'Edit context' }));
    await user.type(screen.getByRole('textbox', { name: 'Context note' }), 'Synthetic note');
    await user.keyboard('{Escape}');
    const dialog = screen.getByRole('dialog');
    fireEvent.pointerDown(dialog.parentElement!);
    fireEvent.click(dialog.parentElement!);
    expect(screen.getByRole('dialog')).toBe(dialog);
    await user.click(screen.getByRole('button', { name: 'Close context panel' }));
    await user.click(screen.getByRole('button', { name: 'Edit context' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('dismisses the mobile context backdrop only when the press starts outside the sheet', async () => {
    const user = userEvent.setup();
    render(<ContextPanelProvider>
      <PanelToggle />
      <ContextPanel modal closeIcon={<span aria-hidden="true">×</span>} />
    </ContextPanelProvider>);
    const trigger = screen.getByRole('button', { name: 'Toggle contextual panel' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Context' });
    const backdrop = dialog.parentElement!;
    expect(backdrop.className).toBe('context-panel-modal-backdrop');
    expect(backdrop.closest('[inert]')).toBeNull();
    fireEvent.pointerDown(dialog);
    fireEvent.click(backdrop);
    expect(screen.getByRole('dialog')).toBe(dialog);
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(backdrop.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });
  it('uses a focus-trapped modal sheet on phones and returns focus on Escape', async () => {
    const user = userEvent.setup();
    render(<ContextPanelProvider>
      <PanelToggle />
      <ContextPanel modal closeIcon={<span aria-hidden="true">×</span>} />
    </ContextPanelProvider>);
    const trigger = screen.getByRole('button', { name: 'Toggle contextual panel' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Context' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const close = screen.getByRole('button', { name: 'Close context panel' });
    expect(document.activeElement).toBe(close);
    await user.tab();
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).not.toBe('hidden');
  });
  it('shows and replaces agent-provided context while preserving the main view', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Jarvis shows an answer' }));
    expect(screen.getByRole('heading', { name: 'Research answer' })).not.toBeNull();
    expect(screen.getByText('The answer is available without replacing the conversation.')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Main conversation' })).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Jarvis changes context' }));
    expect(screen.getByRole('heading', { name: 'Source notes' })).not.toBeNull();
    expect(screen.getByText('Updated source context.')).not.toBeNull();
    expect(screen.queryByText('The answer is available without replacing the conversation.')).toBeNull();
  });

  it('exposes loading and error states accessibly', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Jarvis loads context' }));
    expect(screen.getByRole('status').querySelector('.state-message-copy')?.textContent).toBe('Loading contextual information…');

    await user.click(screen.getByRole('button', { name: 'Jarvis reports a context error' }));
    expect(screen.getByRole('alert').textContent).toBe('The context could not be loaded.');
  });

  it('returns focus to the panel toggle when closing from within the panel', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Jarvis shows an answer' }));
    const close = screen.getByRole('button', { name: 'Close context panel' });
    close.focus();
    act(() => {
      screen.getByRole('button', { name: 'Close by command' }).click();
    });

    expect(screen.queryByRole('heading', { name: 'Research answer' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Toggle contextual panel' }));
  });

  it('does not steal focus when an agent closes a panel while focus is outside', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Jarvis shows an answer' }));
    const closeCommand = screen.getByRole('button', { name: 'Close while focus is outside the panel' });
    await user.click(closeCommand);

    expect(screen.queryByRole('heading', { name: 'Research answer' })).toBeNull();
    expect(document.activeElement).toBe(closeCommand);
  });

  it('renders custom Factory details and returns focus to the selecting task', async () => {
    const user = userEvent.setup();
    renderPanel();

    const selection = screen.getByRole('button', { name: 'Select Factory task' });
    await user.click(selection);
    expect(screen.getByText('Task details stay in the shared panel.')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Close context panel' }));

    expect(screen.queryByText('Task details stay in the shared panel.')).toBeNull();
    expect(document.activeElement).toBe(selection);
  });
});
