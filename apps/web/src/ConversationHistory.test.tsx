import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConversationHistory } from './ConversationHistory';
import { ConversationIntentProvider } from './ConversationIntentProvider';
import { useConversationIntents } from './conversation-intents';
import type { CameraController, ScreenShareController } from './screen-sharing';
import { JarvisActivityProvider } from './activity-provider';
import { useJarvisActivity } from './activity-context';
import { VoiceWorkspaceContext } from './voice-workspace-state';
import type { VoiceClientOptions } from './voice-client';

const { loadConversationHistory, loadImageArtifactUrl, createChatSession, sendChatTurn, steerChatTurn, voiceSessions } = vi.hoisted(() => ({
  loadConversationHistory: vi.fn(),
  loadImageArtifactUrl: vi.fn(),
  createChatSession: vi.fn(),
  sendChatTurn: vi.fn(),
  steerChatTurn: vi.fn(),
  voiceSessions: [] as VoiceClientOptions[],
}));
vi.mock('./conversation-history', async (importOriginal) => ({
  ...await importOriginal<typeof import('./conversation-history')>(),
  loadConversationHistory, loadImageArtifactUrl, createChatSession, sendChatTurn, steerChatTurn,
}));
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
const steeringMessage = { ...userMessage, id: '53', text: 'Continue in English.' };

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

function chooseLanguage(name: 'Danish' | 'English') {
  fireEvent.click(screen.getByRole('button', { name: 'More options' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Language' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name }));
}

function selectedLanguage() {
  fireEvent.click(screen.getByRole('button', { name: 'More options' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Language' }));
  const checked = screen.getAllByRole('menuitemradio').find((item) => item.getAttribute('aria-checked') === 'true');
  fireEvent.keyDown(screen.getByRole('menu', { name: 'Language' }), { key: 'Escape' });
  fireEvent.keyDown(screen.getByRole('menu', { name: 'More options' }), { key: 'Escape' });
  return checked?.textContent;
}

function ActivityProbe() {
  const { working, applyRuntimeActivity } = useJarvisActivity();
  const activityId = '11111111-1111-4111-8111-111111111111';
  return (
    <>
      <output data-testid="activity">{working ? 'working' : 'idle'}</output>
      <button type="button" onClick={() => applyRuntimeActivity({
        type: 'thinking', activityId, source: 'chat',
      })}>Publish chat thinking</button>
      <button type="button" onClick={() => applyRuntimeActivity({
        type: 'ended', activityId, source: 'chat',
      })}>Publish chat end</button>
    </>
  );
}

function FactoryConversationActions() {
  const intents = useConversationIntents();
  return (
    <>
      <button type="button" onClick={() => intents.sendMessage('Send from the Factory board')}>
        Send from Factory
      </button>
      <button type="button" onClick={intents.focusVoiceStart}>Open Factory voice control</button>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  loadImageArtifactUrl.mockReset();
  voiceSessions.length = 0;
  loadConversationHistory.mockResolvedValue({ messages: [], nextCursor: null });
  createChatSession.mockResolvedValue(session);
  steerChatTurn.mockResolvedValue({ ...steeringMessage, language: 'en' });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ConversationHistory', () => {
  it('sends Factory messages through the existing queue and only focuses explicit voice start', async () => {
    const user = userEvent.setup();
    sendChatTurn.mockResolvedValue(assistantMessage);
    render(
      <ConversationIntentProvider>
        <JarvisActivityProvider>
          <MemoryRouter>
            <VoiceWorkspaceContext.Provider value={{ onVoiceActiveChange: vi.fn() }}>
              <ConversationHistory client={client} config={config} />
              <FactoryConversationActions />
            </VoiceWorkspaceContext.Provider>
          </MemoryRouter>
        </JarvisActivityProvider>
      </ConversationIntentProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Send from Factory' }));
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalled());
    expect(sendChatTurn.mock.calls[0]?.[3]).toBe('Send from the Factory board');

    await user.click(screen.getByRole('button', { name: 'Open Factory voice control' }));
    const startVoice = screen.getByRole('button', { name: 'Start voice' });
    await waitFor(() => expect(document.activeElement).toBe(startVoice));
    expect(voiceSessions).toHaveLength(0);
  });

  it('applies voice layout changes immediately without a document view transition', () => {
    const onVoiceActiveChange = vi.fn();
    const startViewTransition = vi.fn();
    const documentWithTransition = document as Document & {
      startViewTransition?: (callback: () => void) => unknown;
    };
    const hadOwnTransition = Object.hasOwn(document, 'startViewTransition');
    const originalTransition = documentWithTransition.startViewTransition;
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: startViewTransition,
    });

    try {
      const { container } = renderConversation(0, undefined, onVoiceActiveChange);
      fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));

      expect(startViewTransition).not.toHaveBeenCalled();
      expect(onVoiceActiveChange).toHaveBeenLastCalledWith(true);
      expect((container.querySelector('#conversation-composer') as HTMLFormElement).hidden).toBe(true);
      expect((container.querySelector('.conversation-transcript') as HTMLDivElement).hidden).toBe(true);
    } finally {
      if (hadOwnTransition) {
        Object.defineProperty(document, 'startViewTransition', {
          configurable: true,
          writable: true,
          value: originalTransition,
        });
      } else {
        Reflect.deleteProperty(document, 'startViewTransition');
      }
    }
  });

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

  it('shows a saved generated image inline in conversation history', async () => {
    const artifactId = '7b96c6a9-9f80-4a8b-8a73-51517fe37512';
    loadConversationHistory.mockResolvedValue({
      messages: [{
        ...message,
        toolCalls: [{
          id: '91', tool: 'image_generation', outcome: 'ok', taskId: null, artifactId,
        }],
      }],
      nextCursor: null,
    });
    loadImageArtifactUrl.mockResolvedValue(
      'https://jarvisstore.blob.core.windows.net/artifacts/workspace-images/image.png?sp=r&spr=https',
    );
    renderConversation();

    const image = await screen.findByRole('img', { name: 'Generated image' });
    expect(image.getAttribute('src')).toContain('blob.core.windows.net/artifacts/workspace-images/image.png');
    expect(loadImageArtifactUrl).toHaveBeenCalledWith(client, config, artifactId, expect.any(AbortSignal));
  });

  it('renders safe Markdown only for Jarvis history', async () => {
    const markdown = [
      '**Bold** and *italic* with `inline code`.',
      '',
      '- First item',
      '- Second item',
      '',
      '```ts',
      'const ready = true;',
      '```',
      '',
      '[Web](https://example.com) [Email](mailto:dan@example.com) [Bad](javascript:alert(1)) [FTP](ftp://example.com)',
      '',
      '![Remote image](https://example.com/image.png)',
      '',
      '<script>alert(1)</script>',
    ].join('\n');
    loadConversationHistory.mockResolvedValue({
      messages: [
        { ...message, channel: 'chat', role: 'jarvis', text: markdown, toolCalls: [] },
        { ...message, id: '44', role: 'dan', text: '**literal** <script>alert(1)</script>', toolCalls: [] },
        { ...message, id: '45', text: '**voice transcript**', toolCalls: [] },
      ],
      nextCursor: null,
    });
    renderConversation();

    const jarvis = (await screen.findByText('Bold')).closest('[data-speaker="jarvis"]');
    expect(jarvis?.querySelector('.markdown-content strong')?.textContent).toBe('Bold');
    expect(jarvis?.querySelector('.markdown-content em')?.textContent).toBe('italic');
    expect(jarvis?.querySelector('p code')?.textContent).toBe('inline code');
    expect(jarvis?.querySelectorAll('ul > li')).toHaveLength(2);
    expect(jarvis?.querySelector('pre code')?.textContent?.trim()).toBe('const ready = true;');
    expect(jarvis?.querySelector('script')).toBeNull();
    expect(jarvis?.querySelector('img')).toBeNull();
    expect(jarvis?.textContent).toContain('Remote image');

    const links = [...(jarvis?.querySelectorAll('a') ?? [])];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://example.com',
      'mailto:dan@example.com',
    ]);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }

    const dan = screen.getByText('**literal** <script>alert(1)</script>').closest('[data-speaker="dan"]');
    expect(dan?.querySelector(':scope > p strong, :scope > p script')).toBeNull();
    expect(screen.getByText('**voice transcript**').closest('[data-speaker="jarvis"]')?.querySelector('.markdown-content')).toBeNull();
  });

  it('shows loading and empty states', async () => {
    let resolve: ((value: { messages: []; nextCursor: null }) => void) | undefined;
    loadConversationHistory.mockReturnValue(new Promise((done) => { resolve = done; }));
    renderConversation();

    expect(screen.getByRole('status').textContent).toBe('Loading conversation history…');
    resolve?.({ messages: [], nextCursor: null });
    expect(await screen.findByRole('heading', { name: 'What’s on your mind?' })).not.toBeNull();
  });

  it.each([{ messages: [] }, { messages: [message] }])('focuses the composer and scrolls to the latest message on load', async ({ messages }) => {
    let resolve!: (page: { messages: typeof messages; nextCursor: null }) => void;
    loadConversationHistory.mockReturnValue(new Promise((done) => { resolve = done; }));
    renderConversation();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message Jarvis' }));
    const transcript = screen.getByLabelText('Conversation history');
    Object.defineProperty(transcript, 'scrollHeight', { value: 1200 });
    await act(async () => resolve({ messages, nextCursor: null }));
    expect(transcript.scrollTop).toBe(1200);
  });

  it('offers a retry after a history failure', async () => {
    loadConversationHistory.mockRejectedValueOnce(new Error('History unavailable'));
    renderConversation();

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'History unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'What’s on your mind?' })).not.toBeNull();
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

  it('streams a reply while allowing new messages and language changes', async () => {
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
      onDelta('**I am');
      return new Promise((resolve) => { finish = resolve; });
    });
    renderConversation();
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: 'Hello Jarvis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const streamedReply = await screen.findByLabelText('Jarvis reply in progress');
    expect(streamedReply.textContent).toBe('I am');
    expect(streamedReply.querySelector('strong')?.textContent).toBe('I am');
    expect(screen.getByRole('status').textContent).toBe('Jarvis is replying…');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'More options' })).toHaveProperty('disabled', false);
    expect(input).toHaveProperty('disabled', false);
    expect(input).toHaveProperty('value', '');
    expect(screen.getByLabelText('Jarvis reply in progress').querySelector('.streaming-caret')?.getAttribute('aria-hidden')).toBe('true');
    finish?.(assistantMessage);

    expect(await screen.findByText('I am ready.')).not.toBeNull();
    expect(createChatSession).toHaveBeenCalledWith(client, config, 'da', expect.any(AbortSignal));
    expect(sendChatTurn).toHaveBeenCalledWith(
      client,
      config,
      session,
      'Hello Jarvis',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      undefined,
      undefined,
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it('shows thinking until the first delta and preserves the next draft through a stale history reload', async () => {
    let accept!: () => void;
    let delta!: (text: string) => void;
    let finish!: (value: typeof assistantMessage) => void;
    loadConversationHistory.mockResolvedValue({ messages: [message], nextCursor: null });
    sendChatTurn.mockImplementation((_client, _config, _session, _text, onUser, onDelta) => {
      accept = () => onUser(userMessage);
      delta = onDelta;
      return new Promise((resolve) => { finish = resolve; });
    });
    renderConversation();
    await screen.findByText(message.text);
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: userMessage.text } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledOnce());
    expect(screen.getByRole('status').textContent).toBe('Jarvis is thinking…');
    expect(screen.queryByLabelText('Jarvis reply in progress')).toBeNull();
    expect(document.querySelector('.streaming-caret')).toBeNull();
    expect(input).toHaveProperty('value', '');
    act(() => accept());
    expect(input).toHaveProperty('value', '');
    fireEvent.change(input, { target: { value: 'My next message' } });
    expect(sendChatTurn).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'More options' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Start voice' })).toHaveProperty('disabled', false);
    act(() => delta('I am'));
    expect(screen.queryByText('Jarvis is thinking…')).toBeNull();
    expect(screen.getByLabelText('Jarvis reply in progress').textContent).toBe('I am');
    await act(async () => finish(assistantMessage));
    await waitFor(() => expect(loadConversationHistory).toHaveBeenCalledTimes(2));
    const list = screen.getByRole('list', { name: 'Messages between Dan and Jarvis' });
    expect([...list.querySelectorAll(':scope > li')].map((item) => item.querySelector(':scope > p, .markdown-content')?.textContent))
      .toEqual([message.text, userMessage.text, assistantMessage.text]);
    expect(input).toHaveProperty('value', 'My next message');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', false);
  });

  it('preserves edits made before acceptance and when an accepted reply fails', async () => {
    let accept!: () => void;
    let fail!: (error: Error) => void;
    sendChatTurn.mockImplementation((_client, _config, _session, _text, onUser) => {
      accept = () => onUser(userMessage);
      return new Promise((_resolve, reject) => { fail = reject; });
    });
    renderConversation();
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: userMessage.text } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledOnce());
    fireEvent.change(input, { target: { value: 'Next draft before acceptance' } });
    act(() => accept());
    expect(input).toHaveProperty('value', 'Next draft before acceptance');
    await act(async () => fail(new Error('Reply interrupted')));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Reply interrupted');
    expect(input).toHaveProperty('value', 'Next draft before acceptance');
    expect(screen.getByText(userMessage.text)).not.toBeNull();
  });

  it('does not resurrect a submitted draft when delivery is uncertain', async () => {
    sendChatTurn.mockImplementation(async (_client, _config, _session, _text, _onUser, _onDelta, onUncertain) => {
      onUncertain();
      throw new Error('Delivery uncertain');
    });
    renderConversation();
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: userMessage.text } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Delivery uncertain');
    expect(input).toHaveProperty('value', '');
  });

  it('queues in order, captures each language, removes a waiting message and ignores double Enter', async () => {
    const finishes: (() => void)[] = [];
    createChatSession.mockImplementation(async (_client, _config, language) => ({ id: '41', language }));
    sendChatTurn.mockImplementation((_client, _config, _session, text, onUser) => {
      const id = 51 + finishes.length * 2;
      onUser({ ...userMessage, id: String(id), text });
      return new Promise((resolve) => {
        finishes.push(() => resolve({ ...assistantMessage, id: String(id + 1), text: `Reply to ${text}` }));
      });
    });
    renderConversation();
    await screen.findByText('What’s on your mind?');
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    const submit = (text: string, queued = false) => {
      fireEvent.change(input, { target: { value: text } });
      fireEvent.keyDown(input, { key: 'Enter', ...(queued ? { ctrlKey: true } : {}) });
    };
    submit('First');
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledOnce());
    submit('Second', true);
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    submit('Remove me', true);
    chooseLanguage('English');
    submit('Third', true);
    expect(screen.getByText('3 messages queued').getAttribute('aria-live')).toBe('polite');
    const queue = screen.getByRole('list', { name: 'Queued messages' });
    expect([...queue.querySelectorAll('li > p:first-of-type')].map((item) => item.textContent))
      .toEqual(['Second', 'Remove me', 'Third']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove queued message: Remove me' }));
    expect(screen.getByText('2 messages queued')).not.toBeNull();
    expect(sendChatTurn).toHaveBeenCalledOnce();
    await act(async () => finishes[0]!());
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledTimes(2));
    expect(sendChatTurn.mock.calls[1]?.slice(2, 4)).toEqual([session, 'Second']);
    expect(screen.getByText('1 message queued')).not.toBeNull();
    await act(async () => finishes[1]!());
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledTimes(3));
    expect(sendChatTurn.mock.calls[2]?.slice(2, 4)).toEqual([{ id: '41', language: 'en' }, 'Third']);
    await act(async () => finishes[2]!());
    expect(screen.queryByRole('list', { name: 'Queued messages' })).toBeNull();
    expect(sendChatTurn.mock.calls.map((call) => call[3])).toEqual(['First', 'Second', 'Third']);
  });

  it('keeps a failed turn visible and drains a queued message after error', async () => {
    let fail!: (error: Error) => void;
    let finish!: (message: typeof assistantMessage) => void;
    sendChatTurn.mockImplementationOnce((_client, _config, _session, _text, onUser, onDelta, _uncertain, _context, _shared, signal) => {
      onUser(userMessage);
      onDelta('Partial');
      return new Promise((_resolve, reject) => {
        fail = reject;
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }).mockImplementationOnce((_client, _config, _session, text, onUser) => {
      onUser({ ...userMessage, id: '53', text });
      return new Promise((resolve) => { finish = resolve; });
    });
    renderConversation();
    await screen.findByText('What’s on your mind?');
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: userMessage.text } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByLabelText('Jarvis reply in progress');
    fireEvent.change(input, { target: { value: 'Next after failure' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await act(async () => fail(new Error('First turn failed')));
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledTimes(2));
    const error = screen.getByRole('alert');
    expect(error.textContent).toContain('First turn failed');
    expect(error.closest('[data-speaker="dan"]')?.textContent).toContain(userMessage.text);
    expect(screen.getByText('Partial reply, interrupted:')).not.toBeNull();
    expect(sendChatTurn.mock.calls[1]?.[3]).toBe('Next after failure');
    await act(async () => finish({ ...assistantMessage, id: '54' }));
    expect(screen.getByRole('alert')).toBe(error);
  });

  it('steers a streaming turn with the selected language and retains the interrupted partial once', async () => {
    let finish!: (message: typeof assistantMessage) => void;
    let interrupt!: (message: typeof assistantMessage) => void;
    sendChatTurn.mockImplementation((_client, _config, _session, _text, onUser, onDelta, _uncertain,
      _context, _shared, _signal, onInterrupted) => {
      onUser(userMessage);
      onDelta('Partial answer');
      interrupt = onInterrupted;
      return new Promise((resolve) => { finish = resolve; });
    });
    renderConversation();
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByLabelText('Jarvis reply in progress');
    chooseLanguage('English');
    fireEvent.change(input, { target: { value: steeringMessage.text } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(steerChatTurn).toHaveBeenCalledWith(
      client, config, session, steeringMessage.text, 'en',
    ));
    expect(screen.getByText('Steering…')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop reply' })).toBeNull();
    fireEvent.change(input, { target: { value: 'A later draft' } });
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Start voice' })).toHaveProperty('disabled', false);

    act(() => interrupt({ ...assistantMessage, id: '54', text: 'Partial answer' }));
    expect(screen.getByText('Interrupted')).not.toBeNull();
    expect(screen.getByText('Partial answer')).not.toBeNull();
    expect(screen.queryByText('Steering…')).toBeNull();
    act(() => finish({ ...assistantMessage, id: '55' }));
    expect(await screen.findByText('I am ready.')).not.toBeNull();
    expect(sendChatTurn).toHaveBeenCalledOnce();
  });

  it('starts voice during a chat reply without cancelling or duplicating it', async () => {
    let finish!: (message: typeof assistantMessage) => void;
    sendChatTurn.mockImplementation((_client, _config, _session, _text, onUser) => {
      onUser(userMessage);
      return new Promise((resolve) => { finish = resolve; });
    });
    renderConversation();
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Jarvis is thinking…');

    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    expect(screen.getByRole('button', { name: 'End voice' })).not.toBeNull();
    expect(sendChatTurn).toHaveBeenCalledOnce();
    await act(async () => finish(assistantMessage));
    expect(sendChatTurn).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'End voice' })).not.toBeNull();
  });

  it('preserves an identical next draft when a stream error reports uncertain delivery after acceptance', async () => {
    let fail!: () => void;
    sendChatTurn.mockImplementation((_client, _config, _session, _text, onUser, _onDelta, onUncertain) => {
      onUser(userMessage);
      return new Promise((_resolve, reject) => {
        fail = () => {
          onUncertain();
          reject(new Error('Stream interrupted'));
        };
      });
    });
    renderConversation();
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: userMessage.text } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(input).toHaveProperty('value', ''));
    fireEvent.change(input, { target: { value: userMessage.text } });
    await act(async () => fail());
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Stream interrupted');
    expect(input).toHaveProperty('value', userMessage.text);
  });

  it('dedupes refreshed history and updates persisted metadata without reordering optimistic messages', async () => {
    const savedUser = { ...userMessage, channel: 'chat', language: 'da', toolCalls: message.toolCalls };
    const savedAssistant = { ...assistantMessage, channel: 'chat', language: 'da', toolCalls: [] };
    loadConversationHistory.mockResolvedValueOnce({ messages: [message], nextCursor: null })
      .mockResolvedValueOnce({ messages: [savedUser, savedAssistant], nextCursor: null });
    sendChatTurn.mockImplementation(async (_client, _config, _session, _text, onUser) => {
      onUser(userMessage);
      return assistantMessage;
    });
    renderConversation();
    await screen.findByText(message.text);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: userMessage.text } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(loadConversationHistory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Task #77' })).toHaveLength(2));
    expect(screen.getByRole('list', { name: 'Messages between Dan and Jarvis' }).querySelectorAll(':scope > li')).toHaveLength(3);
    expect(screen.getAllByText(userMessage.text)).toHaveLength(1);
    expect(screen.getAllByText(assistantMessage.text)).toHaveLength(1);
  });

  it('dedupes overlapping older pages, orders large IDs exactly, and retains the older cursor on refresh', async () => {
    const older = { ...message, id: '9007199254740992', text: 'Older' };
    const newer = { ...message, id: '9007199254740993', text: 'Newer' };
    loadConversationHistory.mockResolvedValueOnce({ messages: [newer], nextCursor: older.id })
      .mockResolvedValueOnce({ messages: [older, newer], nextCursor: '40' })
      .mockResolvedValueOnce({ messages: [newer], nextCursor: older.id })
      .mockResolvedValueOnce({ messages: [message], nextCursor: null });
    const content = (historyRefresh: number) => (
      <JarvisActivityProvider><MemoryRouter>
        <ConversationHistory client={client} config={config} historyRefresh={historyRefresh} />
      </MemoryRouter></JarvisActivityProvider>
    );
    const view = render(content(0));
    await screen.findByText('Newer');
    fireEvent.click(screen.getByRole('button', { name: 'Load older history' }));
    await screen.findByText('Older');
    view.rerender(content(1));
    await waitFor(() => expect(loadConversationHistory).toHaveBeenCalledTimes(3));
    expect([...screen.getByRole('list', { name: 'Messages between Dan and Jarvis' }).querySelectorAll(':scope > li')]
      .map((item) => item.querySelector(':scope > p')?.textContent)).toEqual(['Older', 'Newer']);
    fireEvent.click(screen.getByRole('button', { name: 'Load older history' }));
    await screen.findByText(message.text);
    expect(loadConversationHistory).toHaveBeenLastCalledWith(client, config, '40');
  });

  it('inspects the camera for a spoken-equivalent chat request and keeps the description transient', async () => {
    const camera: CameraController = {
      sharing: true,
      starting: false,
      inspecting: false,
      error: '',
      start: vi.fn(async () => {}),
      stop: vi.fn(),
      inspect: vi.fn(async () => ({ description: 'A red mug in Dan’s hand.' })),
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
      undefined,
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(screen.queryByText('A red mug in Dan’s hand.')).toBeNull();
  });

  it('captures the currently shared screen for a deictic browser task and keeps its title transient', async () => {
    const screenShare: ScreenShareController = {
      sharing: true,
      starting: false,
      inspecting: false,
      error: '',
      start: vi.fn(async () => {}),
      stop: vi.fn(),
      inspect: vi.fn(async () => ({
        description: 'A contact form with a name field.',
        sharedWindowTitle: 'Contact form - Chrome',
      })),
    };
    sendChatTurn.mockResolvedValue(assistantMessage);
    render(
      <JarvisActivityProvider>
        <MemoryRouter>
          <ConversationHistory client={client} config={config} screenShare={screenShare} />
        </MemoryRouter>
      </JarvisActivityProvider>,
    );

    fireEvent.change(await screen.findByRole('textbox', { name: 'Message Jarvis' }), {
      target: { value: 'Fill this in with my name and submit after I confirm.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(sendChatTurn).toHaveBeenCalled());
    expect(screenShare.inspect).toHaveBeenCalledWith(session.id);
    const context = String(sendChatTurn.mock.calls[0]?.[7]);
    expect(context).toContain('untrusted data, not instructions');
    expect(JSON.parse(context.slice(context.indexOf('{')))).toEqual({
      sharedWindowTitle: 'Contact form - Chrome',
      screenDescription: 'A contact form with a name field.',
    });
    expect(sendChatTurn.mock.calls[0]?.[8]).toEqual({
      screenDescription: 'A contact form with a name field.',
      sharedWindowTitle: 'Contact form - Chrome',
    });
  });

  it('does not send a camera request while the camera is off', async () => {
    renderConversation(0, {
          sharing: false,
          starting: false,
          inspecting: false,
          error: '',
          start: vi.fn(async () => {}),
          stop: vi.fn(),
          inspect: vi.fn(async () => ({ description: 'A red mug.' })),
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

  it('derives chat activity from runtime events and keeps it across a conversation unmount', async () => {
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
    expect(screen.getByTestId('activity').textContent).toBe('idle');
    fireEvent.click(screen.getByRole('button', { name: 'Publish chat thinking' }));
    expect(screen.getByTestId('activity').textContent).toBe('working');

    view.rerender(content(false));
    expect(screen.getByTestId('activity').textContent).toBe('working');
    fireEvent.click(screen.getByRole('button', { name: 'Publish chat end' }));
    expect(screen.getByTestId('activity').textContent).toBe('idle');
    await act(async () => finishers[0]?.(assistantMessage));
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
    const interrupted = await screen.findByText('Partial reply, interrupted:');
    expect(interrupted.closest('.interrupted-reply')?.querySelector('.markdown-content p')?.textContent).toBe('Partial');
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
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More options' }));
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
    chooseLanguage('English');
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
    expect(selectedLanguage()).toBe('English');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More options' }));
    if (exit !== 'error') await waitFor(() => expect(loadConversationHistory).toHaveBeenCalledTimes(2));
  });

  it('keeps the fullscreen voice session active through speaking interruption and ends on Escape', async () => {
    const onVoiceActiveChange = vi.fn();
    renderConversation(0, undefined, onVoiceActiveChange);
    await screen.findByRole('heading', { name: 'What’s on your mind?' });
    await userEvent.click(screen.getByRole('button', { name: 'Start voice' }));

    const voice = voiceSessions[0];
    if (!voice) throw new Error('Voice client was not created.');
    expect(onVoiceActiveChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('textbox')).toBeNull();

    act(() => {
      voice.onStatus('speaking', 'Jarvis is speaking.');
      voice.onStatus('listening', 'Listening after interruption.');
    });
    const statusLabel = screen.getByText('Listening');
    expect(statusLabel.closest('[role="status"]')?.getAttribute('aria-atomic')).toBe('true');
    expect(screen.getByText('Listening after interruption.')).not.toBeNull();
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

  it('switches reply language from the More menu by keyboard and sends in that language', async () => {
    const user = userEvent.setup();
    createChatSession.mockResolvedValue({ ...session, language: 'en' });
    sendChatTurn.mockResolvedValue(assistantMessage);
    renderConversation();
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Reply language' })).toBeNull();
    const more = screen.getByRole('button', { name: 'More options' });
    more.focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Language' }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Danish' }));
    expect(screen.getByRole('menuitemradio', { name: 'Danish' }).getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
    expect(selectedLanguage()).toBe('English');
    await user.click(input);
    await user.type(input, 'Hello');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(createChatSession).toHaveBeenCalledWith(client, config, 'en', expect.any(AbortSignal)));
  });

  it('closes the voice More menu with Escape before Escape ends voice', async () => {
    const onVoiceActiveChange = vi.fn();
    renderConversation(0, undefined, onVoiceActiveChange);
    await screen.findByRole('heading', { name: 'What’s on your mind?' });
    await userEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    const voice = voiceSessions[0];
    if (!voice) throw new Error('Voice client was not created.');
    act(() => voice.onStatus('listening', 'Listening for your voice.'));

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByRole('menu', { name: 'More options' })).not.toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onVoiceActiveChange).toHaveBeenLastCalledWith(true);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onVoiceActiveChange).toHaveBeenLastCalledWith(false);
  });

  it('auto-grows the frameless input, bounds long drafts and shrinks again', async () => {
    renderConversation();
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    const height = vi.spyOn(input, 'scrollHeight', 'get').mockReturnValue(96);
    fireEvent.change(input, { target: { value: 'A multiline draft' } });
    expect(input.style.height).toBe('96px');
    height.mockReturnValue(240);
    fireEvent.change(input, { target: { value: 'A longer multiline draft' } });
    expect(input.style.height).toBe('160px');
    height.mockReturnValue(44);
    fireEvent.change(input, { target: { value: '' } });
    expect(input.style.height).toBe('44px');
  });

  it('reflows input height on width changes without a height-observer loop', async () => {
    let resize: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    const view = renderConversation();
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    const height = vi.spyOn(input, 'scrollHeight', 'get').mockReturnValue(96);
    const box = vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ width: 390 } as DOMRect);
    act(() => resize?.());
    expect(input.style.height).toBe('96px');
    height.mockReturnValue(144);
    act(() => resize?.());
    expect(input.style.height).toBe('96px');
    box.mockReturnValue({ width: 200 } as DOMRect);
    act(() => resize?.());
    expect(input.style.height).toBe('144px');
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('shows relative metadata with the exact time available and distinct speakers', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-03T12:02:00.000Z'));
    loadConversationHistory.mockResolvedValue({
      messages: [message, { ...message, id: '43', role: 'dan', text: 'Sure.', toolCalls: [] }],
      nextCursor: null,
    });
    renderConversation();
    const reply = (await screen.findByText('I started the task.')).closest('li');
    expect(reply?.getAttribute('data-speaker')).toBe('jarvis');
    expect(reply?.getAttribute('tabindex')).toBe('0');
    expect(reply?.querySelector('time')?.textContent).toBe('2 minutes ago');
    expect(reply?.querySelector('time')?.getAttribute('datetime')).toBe(message.at);
    expect(reply?.querySelector('time')?.getAttribute('title')).toBe(new Date(message.at).toLocaleString());
    expect(screen.getByText('Sure.').closest('li')?.getAttribute('data-speaker')).toBe('dan');
  });

  const historyPair = [
    { ...message, id: '43', role: 'dan' as const, text: 'Hello Jarvis', toolCalls: [] },
    { ...message, id: '44', channel: 'chat' as const, text: 'I am ready.', toolCalls: [] },
  ];

  it('keeps Dan’s reading position until he returns to the latest message', async () => {
    loadConversationHistory.mockResolvedValue({ messages: historyPair, nextCursor: null });
    renderConversation();
    await screen.findByText('I am ready.');
    const transcript = screen.getByLabelText('Conversation history');
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 300 });

    transcript.scrollTop = 100;
    fireEvent.scroll(transcript);
    const jump = await screen.findByRole('button', { name: 'Jump to latest' });
    fireEvent.click(jump);

    expect(transcript.scrollTop).toBe(1200);
    expect(document.activeElement).toBe(transcript);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
  });

  it('keeps author roles for assistive technology without visible avatars or name headings', async () => {
    loadConversationHistory.mockResolvedValue({ messages: historyPair, nextCursor: null });
    renderConversation();
    const reply = (await screen.findByText('I am ready.')).closest('li');

    expect(reply?.getAttribute('data-speaker')).toBe('jarvis');
    expect(reply?.querySelector('.message-author')?.textContent).toBe('Jarvis');
    expect(reply?.querySelector('.message-author')?.classList.contains('visually-hidden')).toBe(true);
    expect(reply?.querySelector('img, .message-avatar')).toBeNull();
  });

  it('offers visual context from the composer attachment menu only when a source is shared', async () => {
    const camera: CameraController = {
      sharing: true,
      starting: false,
      inspecting: false,
      error: '',
      start: vi.fn(async () => {}),
      stop: vi.fn(),
      inspect: vi.fn(async () => ({ description: 'A red mug.' })),
    };
    renderConversation(0, camera);
    await screen.findByRole('heading', { name: 'What’s on your mind?' });

    fireEvent.click(screen.getByRole('button', { name: 'Attach visual context' }));
    const screenItem = screen.getByRole('menuitem', { name: 'Look at screen' });
    expect(screenItem.getAttribute('aria-disabled')).toBe('true');
    expect(screenItem.getAttribute('title')).toBe('Share your screen from Activity, sharing and backend first.');
    expect(screen.queryByRole('menuitem', { name: 'Language' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Look at camera' }));

    await waitFor(() => expect(camera.inspect).toHaveBeenCalledWith(session.id));
    expect((await screen.findByText(/Camera context is ready for the next message/)).getAttribute('role')).toBe('status');
  });
});
