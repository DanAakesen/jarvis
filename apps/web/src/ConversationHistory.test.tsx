import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationHistory } from './ConversationHistory';

const { loadConversationHistory } = vi.hoisted(() => ({
  loadConversationHistory: vi.fn(),
}));
vi.mock('./conversation-history', () => ({ loadConversationHistory }));

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };
const client = {} as never;
const message = {
  id: '42',
  sessionId: '41',
  channel: 'voice' as const,
  language: 'en' as const,
  role: 'jarvis' as const,
  text: 'I started the task.',
  model: 'gpt-5.6-luna',
  at: '2026-10-03T12:00:00.000Z',
  toolCalls: [{ id: '90', tool: 'factory_create_task', outcome: 'ok' as const, taskId: '77' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  loadConversationHistory.mockResolvedValue({ messages: [], nextCursor: null });
});

describe('ConversationHistory', () => {
  it('shows persisted messages and tool-call task references', async () => {
    loadConversationHistory.mockResolvedValue({ messages: [message], nextCursor: null });
    render(<ConversationHistory client={client} config={config} />);

    expect(await screen.findByText('I started the task.')).not.toBeNull();
    expect(screen.getByText('factory_create_task · ok · Task #77')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Conversation history' })).not.toBeNull();
  });

  it('shows loading and empty states', async () => {
    let resolve: ((value: { messages: []; nextCursor: null }) => void) | undefined;
    loadConversationHistory.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<ConversationHistory client={client} config={config} />);

    expect(screen.getByRole('status').textContent).toBe('Loading conversation history…');
    resolve?.({ messages: [], nextCursor: null });
    expect(await screen.findByText('No conversation history yet.')).not.toBeNull();
  });

  it('offers a retry after a history failure', async () => {
    loadConversationHistory.mockRejectedValueOnce(new Error('History unavailable'));
    render(<ConversationHistory client={client} config={config} />);

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'History unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No conversation history yet.')).not.toBeNull();
    expect(loadConversationHistory).toHaveBeenCalledTimes(2);
  });

  it('loads earlier messages before the current page', async () => {
    const older = { ...message, id: '40', text: 'An earlier message.', toolCalls: [] };
    loadConversationHistory.mockResolvedValueOnce({ messages: [message], nextCursor: '40' })
      .mockResolvedValueOnce({ messages: [older], nextCursor: null });
    render(<ConversationHistory client={client} config={config} />);
    await screen.findByText('I started the task.');

    fireEvent.click(screen.getByRole('button', { name: 'Load older history' }));

    const list = screen.getByRole('list', { name: 'Messages between Dan and Jarvis' });
    expect(await screen.findByText('An earlier message.')).not.toBeNull();
    const renderedMessages = list.querySelectorAll(':scope > li');
    expect(renderedMessages[0]?.textContent).toContain('An earlier message.');
    expect(renderedMessages[1]?.textContent).toContain('I started the task.');
    expect(loadConversationHistory).toHaveBeenLastCalledWith(client, config, '40');
  });
});
