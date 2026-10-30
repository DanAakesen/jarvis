import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeTestConversation } from './RuntimeTestConversation';
import { ChatTurnError, cancelChatTurn, loadConversationHistory, sendChatTurn } from './conversation-history';
vi.mock('./conversation-history', async importOriginal => ({ ...await importOriginal<typeof import('./conversation-history')>(),
  loadConversationHistory: vi.fn(), sendChatTurn: vi.fn(), cancelChatTurn: vi.fn() }));
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

 it('shows a known preaccept sign-in failure, retains the draft and waits for explicit Send', async () => {
  vi.mocked(loadConversationHistory).mockResolvedValue({ messages: [], nextCursor: null });
  vi.mocked(sendChatTurn).mockRejectedValue(new ChatTurnError('Jarvis could not verify your Microsoft sign-in. Sign in again.', undefined, 'not_accepted'));
  const user = userEvent.setup();
  render(<RuntimeTestConversation session={session} config={config} getAccessToken={token} onClose={vi.fn()} />);
  await screen.findByText('No test messages yet.');
  await user.type(screen.getByRole('textbox'), 'Keep this draft');
  await user.click(screen.getByRole('button', { name: 'Send' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Sign in again.');
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'Keep this draft');
  expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', false);
  expect(sendChatTurn).toHaveBeenCalledTimes(1);
 });

 it.each(['managed_session_busy', 'managed_source_already_claimed', 'managed_turn_already_claimed', 'managed_policy_turn_failed'] as const)(
  'keeps %s blocked without suggesting refresh releases the managed claim', async code => {
   vi.mocked(loadConversationHistory).mockResolvedValue({ messages: [], nextCursor: '40' });
   vi.mocked(sendChatTurn).mockRejectedValue(new ChatTurnError('This test conversation cannot continue safely. Return to normal conversation. Refreshing history will not clear the claim.', code, 'accepted'));
   const onClose = vi.fn(); const user = userEvent.setup();
   render(<RuntimeTestConversation session={session} config={config} getAccessToken={token} onClose={onClose} />);
   await screen.findByText('No test messages yet.');
   await user.type(screen.getByRole('textbox'), 'Test this');
   await user.click(screen.getByRole('button', { name: 'Send' }));
   expect((await screen.findByRole('alert')).textContent).toContain('cannot continue safely');
   await user.click(screen.getByRole('button', { name: 'Refresh history' }));
   await waitFor(() => expect(loadConversationHistory).toHaveBeenCalledTimes(2));
   await user.click(screen.getByRole('button', { name: 'Load older messages' }));
   await waitFor(() => expect(loadConversationHistory).toHaveBeenCalledTimes(3));
   expect(screen.getByRole('alert').textContent).toContain('cannot continue safely');
   expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
   expect(sendChatTurn).toHaveBeenCalledTimes(1);
   await user.click(screen.getByRole('button', { name: 'Return to normal conversation' }));
   expect(onClose).toHaveBeenCalledTimes(1);
  });

 it('keeps an accepted typed failure behind explicit history review and never resends it', async () => {
  vi.mocked(loadConversationHistory).mockResolvedValue({ messages: [], nextCursor: null });
  vi.mocked(sendChatTurn).mockImplementation(async (_token, _config, _session, _text, onUser) => {
   onUser(message); throw new ChatTurnError('The managed runtime could not finish the reply. A task action may still have completed.', 'managed_response_failed', 'accepted');
  });
  const user = userEvent.setup();
  render(<RuntimeTestConversation session={session} config={config} getAccessToken={token} onClose={vi.fn()} />);
  await screen.findByText('No test messages yet.');
  await user.type(screen.getByRole('textbox'), 'Test this');
  await user.click(screen.getByRole('button', { name: 'Send' }));
  expect((await screen.findByRole('alert')).textContent).toContain('managed runtime could not finish');
  expect(screen.getByRole('textbox')).toHaveProperty('disabled', true);
  await user.click(screen.getByRole('button', { name: 'Refresh history' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(sendChatTurn).toHaveBeenCalledTimes(1);
 });

 it('allows a new explicit message after reviewing a settled setup failure without replaying the old source', async () => {
  vi.mocked(loadConversationHistory).mockResolvedValue({ messages: [], nextCursor: null });
  vi.mocked(sendChatTurn).mockImplementationOnce(async (_token, _config, _session, _text, onUser) => {
   onUser(message); throw new ChatTurnError('The managed runtime could not prepare the reply. Check history before sending a new message.', 'managed_policy_setup_failed', 'accepted');
  }).mockResolvedValueOnce({ ...message, id: '53', role: 'jarvis', text: 'New explicit reply' });
  const user = userEvent.setup();
  render(<RuntimeTestConversation session={session} config={config} getAccessToken={token} onClose={vi.fn()} />);
  await screen.findByText('No test messages yet.');
  await user.type(screen.getByRole('textbox'), 'Old setup prompt');
  await user.click(screen.getByRole('button', { name: 'Send' }));
  expect((await screen.findByRole('alert')).textContent).toContain('could not prepare');
  expect(screen.getByRole('textbox')).toHaveProperty('disabled', true);
  await user.click(screen.getByRole('button', { name: 'Refresh history' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(sendChatTurn).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('textbox')).toHaveProperty('value', '');
  await user.type(screen.getByRole('textbox'), 'A new explicit prompt');
  await user.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('New explicit reply');
  expect(vi.mocked(sendChatTurn).mock.calls.map(call => call[3])).toEqual(['Old setup prompt', 'A new explicit prompt']);
 });
