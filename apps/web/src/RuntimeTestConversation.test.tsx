import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeTestConversation } from './RuntimeTestConversation';
import { cancelChatTurn, loadConversationHistory, sendChatTurn } from './conversation-history';
vi.mock('./conversation-history', () => ({ loadConversationHistory: vi.fn(), sendChatTurn: vi.fn(), cancelChatTurn: vi.fn() }));
const session = { id: '50', language: 'en' as const, runtimeTest: 'copilot' as const };
const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };
const token = async () => 'synthetic-token';
const message = { id: '51', sessionId: '50', role: 'dan' as const, text: 'Test this', model: null, at: '2026-10-29T12:00:00Z' };
afterEach(() => vi.resetAllMocks());

describe('RuntimeTestConversation', () => {
  it('loads only the immutable test session and sends through its existing stream', async () => {
    vi.mocked(loadConversationHistory).mockResolvedValue({ messages: [], nextCursor: null });
    vi.mocked(sendChatTurn).mockImplementation(async (_token, _config, selected, text, onUser, onDelta) => {
      expect(selected).toBe(session);
      expect(text).toBe('Test this');
      onUser(message); onDelta('Synthetic reply');
      return { ...message, id: '52', role: 'jarvis', text: 'Synthetic reply' };
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<RuntimeTestConversation session={session} config={config} getAccessToken={token} onClose={onClose} />);
    await screen.findByText('No test messages yet.');
    expect(loadConversationHistory).toHaveBeenCalledWith(token, config, undefined, '50');
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Copilot test conversation' })).not.toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Message Copilot' }), 'Test this');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Synthetic reply');
    expect(sendChatTurn).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Return to normal conversation' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('keeps uncertain failures visible and requires history review without automatically sending again', async () => {
    vi.mocked(loadConversationHistory).mockResolvedValue({ messages: [], nextCursor: null });
    vi.mocked(sendChatTurn).mockRejectedValue(new Error('connection lost'));
    const user = userEvent.setup();
    render(<RuntimeTestConversation session={session} config={config} getAccessToken={token} onClose={vi.fn()} />);
    await screen.findByText('No test messages yet.');
    await user.type(screen.getByRole('textbox'), 'Test this');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toContain('may have completed');
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
    expect(sendChatTurn).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Refresh history' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(sendChatTurn).toHaveBeenCalledTimes(1);
  });
  it('blocks leaving during a reply and cancels only the accepted test turn', async () => {
    vi.mocked(loadConversationHistory).mockResolvedValue({ messages: [], nextCursor: null });
    let reject!: () => void;
    vi.mocked(sendChatTurn).mockImplementation((_token, _config, _session, _text, onUser) => {
      onUser(message);
      return new Promise((_resolve, fail) => { reject = () => fail(new Error('stopped')); });
    });
    vi.mocked(cancelChatTurn).mockImplementation(async () => { reject(); });
    const user = userEvent.setup(); const onClose = vi.fn();
    render(<RuntimeTestConversation session={session} config={config} getAccessToken={token} onClose={onClose} />);
    await screen.findByText('No test messages yet.');
    await user.type(screen.getByRole('textbox'), 'Test this');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Stop reply' }));
    expect(cancelChatTurn).toHaveBeenCalledWith(token, config, { sessionId: '50', messageId: '51', language: 'en' });
  });
});
