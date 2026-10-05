import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConversationHistory } from './ConversationHistory';
import type { CameraController } from './screen-sharing';
import { JarvisActivityProvider } from './activity-provider';
import { useJarvisActivity } from './activity-context';
import { VoiceWorkspaceContext } from './voice-workspace-state';
import type { VoiceClientOptions } from './voice-client';

const { loadConversationHistory, createChatSession, sendChatTurn, voiceSessions } = vi.hoisted(() => ({
  loadConversationHistory: vi.fn(),
  createChatSession: vi.fn(),
  sendChatTurn: vi.fn(),
  voiceSessions: [] as VoiceClientOptions[],
}));
vi.mock('./conversation-history', () => ({ loadConversationHistory, createChatSession, sendChatTurn }));
vi.mock('./voice-client', () => ({
  BrowserVoiceClient: class {
    constructor(private readonly options: VoiceClientOptions) { voiceSessions.push(options); }
    start() { this.options.onStatus('ready', 'Microphone is off.'); }
    stop() { this.options.onStatus('stopped', 'Voice is off.'); this.options.onSessionEnded?.(); }
    enableMicrophone = vi.fn(async () => {});
    setMuted = vi.fn();
  },
}));

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

function renderConversation(historyRefresh = 0, camera?: CameraController, onVoiceActiveChange = vi.fn()) {
  return render(
    <JarvisActivityProvider>
      <MemoryRouter>
        <VoiceWorkspaceContext.Provider value={{ onVoiceActiveChange }}>
          <ConversationHistory
            client={client}
            config={config}
            historyRefresh={historyRefresh}
            {...(camera ? { camera } : {})}
          />
        </VoiceWorkspaceContext.Provider>
      </MemoryRouter>
    </JarvisActivityProvider>,
  );
}

function ActivityProbe() {
  const { working } = useJarvisActivity();
  return <output data-testid="activity">{working ? 'working' : 'idle'}</output>;
}

beforeEach(() => {
  vi.clearAllMocks();
  voiceSessions.length = 0;
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
      <JarvisActivityProvider>
        <MemoryRouter>
          <ConversationHistory client={client} config={config} historyRefresh={1} />
        </MemoryRouter>
      </JarvisActivityProvider>,
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
    renderConversation(0, camera);

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
    renderConversation(0, {
          sharing: false,
          starting: false,
          inspecting: false,
          error: '',
          start: vi.fn(async () => {}),
          stop: vi.fn(),
          inspect: vi.fn(async () => 'A red mug.'),
        });

    fireEvent.change(await screen.findByRole('textbox', { name: 'Message Jarvis' }), {
      target: { value: 'What am I holding?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect((await screen.findByRole('alert')).textContent)
      .toBe('Turn on the camera from the top bar before asking Jarvis to inspect a frame.');
    expect(createChatSession).not.toHaveBeenCalled();
    expect(sendChatTurn).not.toHaveBeenCalled();
  });

  it('keeps chat activity active until an in-flight turn settles after unmount', async () => {
    const finishers: Array<(value: typeof assistantMessage) => void> = [];
    sendChatTurn.mockImplementation(async () => new Promise((resolve) => { finishers.push(resolve); }));
    const content = (showConversation: boolean) => (
      <JarvisActivityProvider>
        <MemoryRouter>
          <ActivityProbe />
          {showConversation && <ConversationHistory client={client} config={config} />}
        </MemoryRouter>
      </JarvisActivityProvider>
    );
    const view = render(content(true));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message Jarvis' }), {
      target: { value: 'Hello Jarvis' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledOnce());
    expect(screen.getByTestId('activity').textContent).toBe('working');

    view.rerender(content(false));
    expect(screen.getByTestId('activity').textContent).toBe('working');
    view.rerender(content(true));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message Jarvis' }), {
      target: { value: 'Another question' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledTimes(2));

    finishers[0]?.(assistantMessage);
    expect(screen.getByTestId('activity').textContent).toBe('working');
    finishers[1]?.(assistantMessage);
    await waitFor(() => expect(screen.getByTestId('activity').textContent).toBe('idle'));
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

  it('keeps an unsent draft after a send failure and restores input focus', async () => {
    sendChatTurn.mockRejectedValueOnce(new Error('Could not send. Try again.'));
    renderConversation();
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not send. Try again.');
    expect(input).toHaveProperty('value', 'Keep this draft');
    expect(document.activeElement).toBe(input);
  });

  it('sends with Enter, preserves Shift+Enter and ignores composing input', async () => {
    sendChatTurn.mockResolvedValue(assistantMessage);
    const user = userEvent.setup();
    renderConversation();
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    await user.click(input);
    await user.type(input, 'Hello');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(input).toHaveProperty('value', 'Hello\n');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(sendChatTurn).not.toHaveBeenCalled();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start voice' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Send' }));
    await user.click(input);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledOnce());
    await waitFor(() => expect(input).toHaveProperty('disabled', false));
    expect(document.activeElement).toBe(input);
  });

  it.each(['stop', 'natural', 'error'] as const)('restores typing and draft after voice %s', async (exit) => {
    const user = userEvent.setup();
    loadConversationHistory.mockResolvedValue({ messages: [message], nextCursor: null });
    renderConversation();
    await screen.findByText('I started the task.');
    expect(voiceSessions).toHaveLength(0);
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    await user.click(input);
    await user.type(input, 'Unsent draft');
    await user.click(screen.getByRole('radio', { name: 'English' }));
    const start = screen.getByRole('button', { name: 'Start voice' });
    start.focus();
    await user.keyboard('{Enter}');
    expect(voiceSessions).toHaveLength(1);
    expect(voiceSessions[0]?.language).toBe('en');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('I started the task.')).not.toBeNull();
    expect(screen.getByText('I started the task.').closest('[hidden]')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'End voice' }));
    if (exit === 'stop') {
      await user.keyboard('{Enter}');
    } else {
      act(() => {
        voiceSessions[0]?.onStatus(exit === 'error' ? 'error' : 'stopped', exit === 'error' ? 'Connection failed.' : 'Voice is off.');
        if (exit === 'natural') voiceSessions[0]?.onSessionEnded?.();
      });
    }
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toBe(input);
    expect(input).toHaveProperty('value', 'Unsent draft');
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('radio', { name: 'English' })).toHaveProperty('checked', true);
    if (exit !== 'error') await waitFor(() => expect(loadConversationHistory).toHaveBeenCalledTimes(2));
  });

  it('keeps the fullscreen voice session active through speaking interruption and ends on Escape', async () => {
    const onVoiceActiveChange = vi.fn();
    renderConversation(0, undefined, onVoiceActiveChange);
    await screen.findByText('No messages yet. Send a message to begin the conversation.');
    await userEvent.click(screen.getByRole('button', { name: 'Start voice' }));

    const voice = voiceSessions[0];
    if (!voice) throw new Error('Voice client was not created.');
    expect(onVoiceActiveChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('textbox')).toBeNull();

    act(() => {
      voice.onStatus('speaking', 'Jarvis is speaking.');
      voice.onStatus('listening', 'Listening after interruption.');
    });
    expect(screen.getByText('Listening after interruption.').getAttribute('role')).toBe('status');
    expect(onVoiceActiveChange).toHaveBeenCalledTimes(1);

    const menu = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Workspace menu';
    menu.append(summary);
    menu.open = true;
    document.body.append(menu);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(onVoiceActiveChange).toHaveBeenLastCalledWith(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onVoiceActiveChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).not.toBeNull();
    menu.remove();
  });
});
