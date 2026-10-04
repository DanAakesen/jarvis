import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConversationHistory } from './ConversationHistory';
import type { CameraController } from './screen-sharing';

const { loadConversationHistory, createChatSession, sendChatTurn } = vi.hoisted(() => ({
  loadConversationHistory: vi.fn(),
  createChatSession: vi.fn(),
  sendChatTurn: vi.fn(),
}));
vi.mock('./conversation-history', () => ({ loadConversationHistory, createChatSession, sendChatTurn }));

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
  voiceMinutes: 2.5,
  at: '2026-10-03T12:00:00.000Z',
  toolCalls: [{ id: '90', tool: 'factory_create_task', outcome: 'ok' as const, taskId: '77' }],
};
const session = { id: '41', language: 'da' as const };
const userMessage = {
  id: '51', sessionId: '41', role: 'dan' as const, text: 'Hello Jarvis', model: null, voiceMinutes: null, at: '2026-10-03T12:01:00.000Z',
};
const assistantMessage = {
  id: '52', sessionId: '41', role: 'jarvis' as const, text: 'I am ready.', model: null, voiceMinutes: null, at: '2026-10-03T12:02:00.000Z',
};

function renderConversation(historyRefresh = 0) {
  return render(
    <MemoryRouter>
      <ConversationHistory client={client} config={config} historyRefresh={historyRefresh} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  loadConversationHistory.mockResolvedValue({ messages: [], nextCursor: null });
  createChatSession.mockResolvedValue(session);
});

describe('ConversationHistory', () => {
  it('shows persisted tool outcomes and task links', async () => {
    loadConversationHistory.mockResolvedValue({
      messages: [message, { ...message, id: '43', role: 'dan', text: 'Sure.', toolCalls: [] }],
      nextCursor: null,
    });
    renderConversation();

    expect(await screen.findByText('I started the task.')).not.toBeNull();
    expect(screen.getByText('Sure.')).not.toBeNull();
    expect(screen.getByText('Voice · English · 2.5 voice minutes')).not.toBeNull();
    expect(screen.getAllByText(/voice minutes/u)).toHaveLength(1);
    expect(screen.getByText('factory_create_task · ok')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Task #77' }).getAttribute('href')).toBe('/factory/tasks/77');
  });

  it('shows loading and empty states', async () => {
    let resolve: ((value: { messages: []; nextCursor: null }) => void) | undefined;
    loadConversationHistory.mockReturnValue(new Promise((done) => { resolve = done; }));
    renderConversation();

    expect(screen.getByRole('status').textContent).toBe('Loading conversation history…');
    resolve?.({ messages: [], nextCursor: null });
    expect(await screen.findByText('No messages yet. Send a message to begin the conversation.')).not.toBeNull();
  });

  it('offers a retry after a history failure', async () => {
    loadConversationHistory.mockRejectedValueOnce(new Error('History unavailable'));
    renderConversation();

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'History unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No messages yet. Send a message to begin the conversation.')).not.toBeNull();
    expect(loadConversationHistory).toHaveBeenCalledTimes(2);
  });

  it('loads earlier messages before the current page', async () => {
    const older = { ...message, id: '40', text: 'An earlier message.', toolCalls: [] };
    loadConversationHistory.mockResolvedValueOnce({ messages: [message], nextCursor: '40' })
      .mockResolvedValueOnce({ messages: [older], nextCursor: null });
    renderConversation();
    await screen.findByText('I started the task.');

    fireEvent.click(screen.getByRole('button', { name: 'Load older history' }));

    const list = screen.getByRole('list', { name: 'Messages between Dan and Jarvis' });
    expect(await screen.findByText('An earlier message.')).not.toBeNull();
    const renderedMessages = list.querySelectorAll(':scope > li');
    expect(renderedMessages[0]?.textContent).toContain('An earlier message.');
    expect(renderedMessages[1]?.textContent).toContain('I started the task.');
    expect(loadConversationHistory).toHaveBeenLastCalledWith(client, config, '40');
  });

  it('reloads persisted history after a voice session ends', async () => {
    loadConversationHistory.mockResolvedValue({ messages: [message], nextCursor: null });
    const view = renderConversation();
    expect(await screen.findByText('I started the task.')).not.toBeNull();

    view.rerender(
      <MemoryRouter>
        <ConversationHistory client={client} config={config} historyRefresh={1} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(loadConversationHistory).toHaveBeenCalledTimes(2));
  });

  it('streams a reply while keeping the send control pending', async () => {
    let finish: ((value: typeof assistantMessage) => void) | undefined;
    const savedHistory = [userMessage, assistantMessage].map((saved) => ({
      ...saved,
      channel: 'chat' as const,
      language: 'da' as const,
      toolCalls: [],
    }));
    loadConversationHistory.mockResolvedValueOnce({ messages: [], nextCursor: null })
      .mockResolvedValueOnce({ messages: savedHistory, nextCursor: null });
    sendChatTurn.mockImplementation(async (_client, _config, _session, _text, onUser, onDelta) => {
      onUser(userMessage);
      onDelta('I am');
      return new Promise((resolve) => { finish = resolve; });
    });
    renderConversation();
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: 'Hello Jarvis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByLabelText('Jarvis reply in progress')).toHaveProperty('textContent', 'I am');
    expect(screen.getByRole('status').textContent).toBe('Jarvis is replying…');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
    finish?.(assistantMessage);

    expect(await screen.findByText('I am ready.')).not.toBeNull();
    expect(createChatSession).toHaveBeenCalledWith(client, config, 'da');
    expect(sendChatTurn).toHaveBeenCalledWith(
      client,
      config,
      session,
      'Hello Jarvis',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      undefined,
    );
  });

  it('inspects the camera for a spoken-equivalent chat request and keeps the description transient', async () => {
    const camera: CameraController = {
      sharing: true,
      starting: false,
      inspecting: false,
      error: '',
      start: vi.fn(async () => {}),
      stop: vi.fn(),
      inspect: vi.fn(async () => 'A red mug in Dan’s hand.'),
    };
    sendChatTurn.mockResolvedValue(assistantMessage);
    render(
      <MemoryRouter>
        <ConversationHistory client={client} config={config} camera={camera} />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByRole('textbox', { name: 'Message Jarvis' }), {
      target: { value: 'What am I holding?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(sendChatTurn).toHaveBeenCalled());
    expect(camera.inspect).toHaveBeenCalledWith(session.id);
    expect(sendChatTurn).toHaveBeenCalledWith(
      client,
      config,
      session,
      'What am I holding?',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      'A red mug in Dan’s hand.',
    );
    expect(screen.queryByText('A red mug in Dan’s hand.')).toBeNull();
  });

  it('does not send a camera request while the camera is off', async () => {
    render(
      <MemoryRouter>
        <ConversationHistory client={client} config={config} camera={{
          sharing: false,
          starting: false,
          inspecting: false,
          error: '',
          start: vi.fn(async () => {}),
          stop: vi.fn(),
          inspect: vi.fn(async () => 'A red mug.'),
        }} />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByRole('textbox', { name: 'Message Jarvis' }), {
      target: { value: 'What am I holding?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect((await screen.findByRole('alert')).textContent)
      .toBe('Turn on the camera from the top bar before asking Jarvis to inspect a frame.');
    expect(createChatSession).not.toHaveBeenCalled();
    expect(sendChatTurn).not.toHaveBeenCalled();
  });

  it('shows partial text and recovery guidance after an interrupted reply', async () => {
    const savedUser = {
      ...userMessage,
      channel: 'chat' as const,
      language: 'da' as const,
      toolCalls: [],
    };
    loadConversationHistory.mockResolvedValueOnce({ messages: [], nextCursor: null })
      .mockResolvedValueOnce({ messages: [savedUser], nextCursor: null });
    sendChatTurn.mockImplementationOnce(async (_client, _config, _session, _text, onUser, onDelta) => {
      onUser(userMessage);
      onDelta('Partial');
      throw new Error('A task action may still have completed; check its status before trying again.');
    });
    renderConversation();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message Jarvis' }), {
      target: { value: 'Start a task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'A task action may still have completed; check its status before trying again.',
    );
    expect(await screen.findByText('Partial reply, interrupted: Partial')).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveProperty('value', '');
  });
});
