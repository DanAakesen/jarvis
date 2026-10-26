import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ConversationHistory } from './ConversationHistory';
import { ConversationIntentProvider } from './ConversationIntentProvider';
import { useConversationIntents } from './conversation-intents';
import type { CameraController, ScreenShareController } from './screen-sharing';
import { JarvisActivityProvider } from './activity-provider';
import { useJarvisActivity } from './activity-context';
import { VoiceWorkspaceContext } from './voice-workspace-state';
import { ConversationWindowContext } from './conversation-window-state';
import type { VoiceClientOptions } from './voice-client';

const { loadActiveChatTurns, loadConversationHistory, loadImageArtifactUrl, createChatSession, sendChatTurn, steerChatTurn, voiceSessions } = vi.hoisted(() => ({
  loadActiveChatTurns: vi.fn(),
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
  loadActiveChatTurns,
}));
vi.mock('./voice-client', () => ({
  BrowserVoiceClient: class {
    constructor(private readonly options: VoiceClientOptions) { voiceSessions.push(options); }
    start() { this.options.onStatus('ready', 'Microphone is off.'); }
    stop() { this.options.onStatus('stopped', 'Voice is off.'); this.options.onSessionEnded?.(); }
    retryMicrophone = vi.fn(async () => {});
    playbackLevel = () => 0;
    inputLevel = () => 0;
    setMuted = vi.fn();
  },
}));

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };
const client = {} as never;
const getAccessToken = vi.fn(async () => 'test-token');
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

class MockDictationRecognition {
  static instance: MockDictationRecognition;
  static failStart = false;
  lang = '';
  interimResults = false;
  continuous = false;
  onstart: (() => void) | null = null;
  onresult: ((event: Event & { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }> }) => void) | null = null;
  onerror: ((event: Event & { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => { if (MockDictationRecognition.failStart) throw new Error("Unavailable"); });
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();

  constructor() {
    MockDictationRecognition.instance = this;
  }

  results: { isFinal: boolean; 0: { transcript: string } }[] = [];

  emitTranscript(transcript: string, isFinal = true) {
    const last = this.results.at(-1);
    const index = last && !last.isFinal ? this.results.length - 1 : this.results.length;
    this.results[index] = { isFinal, 0: { transcript } };
    this.onresult?.({ resultIndex: index, results: this.results } as unknown as Event & {
      resultIndex: number;
      results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }>;
    });
  }
}

function renderConversation(historyRefresh = 0, camera?: CameraController, onVoiceActiveChange = vi.fn(), screenShare?: ScreenShareController, phone = false) {
  return render(
    <JarvisActivityProvider>
      <MemoryRouter>
        <VoiceWorkspaceContext.Provider value={{ onVoiceActiveChange }}>
          <ConversationHistory
            client={client}
            getAccessToken={getAccessToken}
            config={config}
            historyRefresh={historyRefresh}
            phone={phone}
            {...(camera ? { camera } : {})}
            {...(screenShare ? { screenShare } : {})}
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
  MockDictationRecognition.failStart = false;
  loadActiveChatTurns.mockResolvedValue([]);
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
  it('keeps the phone draft focused through Send and repeated pending sends without duplicating turns', async () => {
    const user = userEvent.setup();
    sendChatTurn.mockImplementation(() => new Promise(() => {}));
    renderConversation(0, undefined, vi.fn(), undefined, true);
    const textbox = screen.getByRole('textbox', { name: 'Message Jarvis' });
    const send = screen.getByRole('button', { name: 'Send' });
    await user.type(textbox, 'Synthetic first message');
    await user.pointer({ target: send, keys: '[MouseLeft>]' });
    expect(document.activeElement).toBe(textbox);
    expect(createChatSession).not.toHaveBeenCalled();
    await user.pointer({ target: send, keys: '[/MouseLeft]' });
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(textbox);
    expect(textbox).toHaveProperty('value', '');
    expect(send).toHaveProperty('disabled', true);
    await user.click(send);
    expect(sendChatTurn).toHaveBeenCalledTimes(1);
    await user.type(textbox, 'Synthetic follow-up');
    await user.click(send);
    await waitFor(() => expect(steerChatTurn).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(textbox);
    expect(textbox).toHaveProperty('value', '');
    await user.click(send);
    expect(steerChatTurn).toHaveBeenCalledTimes(1);
  });

  it('does not submit a cancelled phone press and preserves recovery after a rejected send', async () => {
    const user = userEvent.setup();
    sendChatTurn.mockRejectedValueOnce(new Error('Synthetic offline failure'));
    renderConversation(0, undefined, vi.fn(), undefined, true);
    const textbox = screen.getByRole('textbox', { name: 'Message Jarvis' });
    const send = screen.getByRole('button', { name: 'Send' });
    await user.type(textbox, 'Synthetic retry draft');
    fireEvent.pointerDown(send, { pointerType: 'touch', button: 0 });
    fireEvent.pointerCancel(send, { pointerType: 'touch' });
    expect(createChatSession).not.toHaveBeenCalled();
    expect(textbox).toHaveProperty('value', 'Synthetic retry draft');
    expect(document.activeElement).toBe(textbox);
    await user.click(send);
    await waitFor(() => expect(screen.getByText('Synthetic offline failure')).toBeTruthy());
    expect(document.activeElement).toBe(textbox);
    expect(textbox).toHaveProperty('value', 'Synthetic retry draft');
    sendChatTurn.mockResolvedValueOnce(assistantMessage);
    await user.click(send);
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledTimes(2));
    expect(document.activeElement).toBe(textbox);
    expect(textbox).toHaveProperty('value', '');
  });

  it('retains keyboard activation when Send is explicitly focused', async () => {
    const user = userEvent.setup();
    sendChatTurn.mockImplementation(() => new Promise(() => {}));
    renderConversation(0, undefined, vi.fn(), undefined, true);
    await user.type(screen.getByRole('textbox', { name: 'Message Jarvis' }), 'Synthetic keyboard send');
    screen.getByRole('button', { name: 'Send' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledTimes(1));
  });

  it('reattaches on mount with original identity without adding a Stop control', async () => {
    const recovered = { sessionId: '41', messageId: '51', language: 'en' };
    loadActiveChatTurns.mockResolvedValueOnce([recovered]);
    let finish: ((value: typeof assistantMessage) => void) | undefined;
    const result = new Promise<typeof assistantMessage>(resolve => { finish = resolve; });
    sendChatTurn.mockImplementation(async (_token, _config, _session, _text, onUser) => {
      onUser(userMessage);
      return result;
    });
    renderConversation();
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledOnce());
    expect(sendChatTurn.mock.calls[0]![2]).toEqual({ id: '41', language: 'en' });
    expect(sendChatTurn.mock.calls[0]![15]).toBe('51');
    expect(createChatSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Stop reply' })).toBeNull();
    finish?.(assistantMessage);
    await screen.findByText(assistantMessage.text);
  });

  it('refreshes persisted results on return without submitting another turn', async () => {
    renderConversation();
    await waitFor(() => expect(loadActiveChatTurns).toHaveBeenCalledOnce());
    loadConversationHistory.mockResolvedValue({ messages: [message], nextCursor: null });
    fireEvent(document, new Event('visibilitychange'));
    expect(await screen.findByText(message.text)).not.toBeNull();
    expect(sendChatTurn).not.toHaveBeenCalled();
    expect(createChatSession).not.toHaveBeenCalled();
  });

  it('dictates into the draft without starting or sending an assistant turn', async () => {
    vi.stubGlobal('SpeechRecognition', MockDictationRecognition);
    const user = userEvent.setup();
    renderConversation(0, undefined, vi.fn(), undefined, true);
    const textbox = screen.getByRole('textbox', { name: 'Message Jarvis' });
    await user.type(textbox, 'Remember');
    await user.click(screen.getByRole('button', { name: 'Dictate' }));
    expect(MockDictationRecognition.instance.lang).toBe('en-US');
    expect(screen.getByRole('button', { name: 'Stop dictation' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('dictation-status')?.textContent).toBe('Listening. Tap Stop dictation to finish.');
    act(() => MockDictationRecognition.instance.emitTranscript('the launch time'));
    expect(textbox).toHaveProperty('value', 'Remember the launch time');
    expect(screen.getByRole('button', { name: 'Stop dictation' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).not.toBeNull();
    expect(sendChatTurn).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Stop dictation' }));
    expect(screen.queryByRole('button', { name: 'Stop dictation' })).toBeNull();
  });

  it('streams revised interim snapshots once and keeps listening across silence and repeated toggles', async () => {
    vi.stubGlobal('SpeechRecognition', MockDictationRecognition);
    const user = userEvent.setup();
    renderConversation();
    const textbox = screen.getByRole('textbox', { name: 'Message Jarvis' });
    await user.type(textbox, 'Remember');
    await user.click(screen.getByRole('button', { name: 'Dictate' }));
    const first = MockDictationRecognition.instance;
    expect(first.continuous).toBe(true);
    expect(first.interimResults).toBe(true);
    act(() => first.emitTranscript('the lunch', false));
    expect(textbox).toHaveProperty('value', 'Remember the lunch');
    act(() => first.emitTranscript('the launch', false));
    expect(textbox).toHaveProperty('value', 'Remember the launch');
    act(() => first.emitTranscript('the launch'));
    act(() => first.onresult?.({ resultIndex: 0, results: first.results } as never));
    expect(textbox).toHaveProperty('value', 'Remember the launch');
    act(() => first.emitTranscript('tomorrow', false));
    act(() => first.onend?.());
    const second = MockDictationRecognition.instance;
    expect(second).not.toBe(first);
    expect(second.start).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Stop dictation' })).not.toBeNull();
    act(() => {
      first.emitTranscript('stale');
      first.onend?.();
      second.onerror?.({ error: 'no-speech' } as never);
      second.onend?.();
    });
    expect(screen.queryByRole('alert')).toBeNull();
    const third = MockDictationRecognition.instance;
    act(() => third.emitTranscript('at noon'));
    expect(textbox).toHaveProperty('value', 'Remember the launch tomorrow at noon');
    await user.click(screen.getByRole('button', { name: 'Stop dictation' }));
    expect(MockDictationRecognition.instance).toBe(third);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await user.click(screen.getByRole('button', { name: 'Dictate' }));
      act(() => MockDictationRecognition.instance.emitTranscript('again'));
      await user.click(screen.getByRole('button', { name: 'Stop dictation' }));
    }
    expect(textbox).toHaveProperty('value', 'Remember the launch tomorrow at noon again again again');
    expect(sessionStorage.getItem('jarvis.chat.draft')).toContain('Remember the launch');
    expect(sendChatTurn).not.toHaveBeenCalled();
    expect(voiceSessions).toHaveLength(0);
  });

  it('preserves typed edits while later recognition snapshots stream', async () => {
    vi.stubGlobal('SpeechRecognition', MockDictationRecognition);
    const user = userEvent.setup();
    renderConversation();
    const textbox = screen.getByRole('textbox', { name: 'Message Jarvis' });
    await user.click(screen.getByRole('button', { name: 'Dictate' }));
    const recognition = MockDictationRecognition.instance;
    act(() => recognition.emitTranscript('old words', false));
    fireEvent.change(textbox, { target: { value: 'My correction' } });
    act(() => recognition.emitTranscript('old words'));
    expect(textbox).toHaveProperty('value', 'My correction');
    act(() => recognition.emitTranscript('new words', false));
    expect(textbox).toHaveProperty('value', 'My correction new words');
    act(() => recognition.emitTranscript('new wording'));
    expect(textbox).toHaveProperty('value', 'My correction new wording');
  });

  it.each([false, true])('keeps new speech after edited interim results disappear (prior snapshot: %s)', async (priorSnapshot) => {
    vi.stubGlobal('SpeechRecognition', MockDictationRecognition);
    const user = userEvent.setup();
    renderConversation();
    const textbox = screen.getByRole('textbox', { name: 'Message Jarvis' });
    await user.click(screen.getByRole('button', { name: 'Dictate' }));
    const recognition = MockDictationRecognition.instance;
    act(() => {
      recognition.emitTranscript('hello');
      recognition.emitTranscript('guess', false);
    });
    expect(textbox).toHaveProperty('value', 'hello guess');
    fireEvent.change(textbox, { target: { value: 'My correction' } });
    if (priorSnapshot) act(() => recognition.onresult?.({ resultIndex: 1, results: recognition.results } as never));
    act(() => {
      recognition.results.pop();
      recognition.onresult?.({ resultIndex: 1, results: recognition.results } as never);
    });
    expect(textbox).toHaveProperty('value', 'My correction');
    act(() => recognition.emitTranscript('new words', false));
    expect(textbox).toHaveProperty('value', 'My correction new words');
    act(() => recognition.emitTranscript('new wording'));
    act(() => recognition.onresult?.({ resultIndex: 0, results: recognition.results } as never));
    expect(textbox).toHaveProperty('value', 'My correction new wording');
    expect(sessionStorage.getItem('jarvis.chat.draft')).toBe('My correction new wording');
  });

  it.each(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'aborted'])('stops on active %s failures without restarting', async (error) => {
    vi.stubGlobal('SpeechRecognition', MockDictationRecognition);
    const user = userEvent.setup();
    renderConversation();
    await user.click(screen.getByRole('button', { name: 'Dictate' }));
    const recognition = MockDictationRecognition.instance;
    act(() => recognition.emitTranscript('Keep this', false));
    act(() => {
      recognition.onerror?.({ error } as never);
      recognition.onend?.();
    });
    expect(screen.getByRole('alert')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Dictate' })).not.toBeNull();
    expect(MockDictationRecognition.instance).toBe(recognition);
    expect(recognition.abort).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveProperty('value', 'Keep this');
  });

  it.each([false, true])('reports a start exception (restart: %s)', async (restart) => {
    vi.stubGlobal('SpeechRecognition', MockDictationRecognition);
    const user = userEvent.setup();
    renderConversation();
    if (!restart) MockDictationRecognition.failStart = true;
    await user.click(screen.getByRole('button', { name: 'Dictate' }));
    if (restart) {
      MockDictationRecognition.failStart = true;
      act(() => MockDictationRecognition.instance.onend?.());
    }
    expect(screen.getByRole('alert').textContent).toContain('Dictation could not start');
    expect(screen.getByRole('button', { name: 'Dictate' })).not.toBeNull();
  });

  it('ignores callbacks after unmount', async () => {
    vi.stubGlobal('SpeechRecognition', MockDictationRecognition);
    const user = userEvent.setup();
    const view = renderConversation();
    await user.click(screen.getByRole('button', { name: 'Dictate' }));
    const first = MockDictationRecognition.instance;
    view.unmount();
    act(() => first.onend?.());
    expect(first.abort).toHaveBeenCalledOnce();
    expect(MockDictationRecognition.instance).toBe(first);
  });

  it.each(['aborted', 'no-speech'])('retains final text after requested stop and %s before end', async (error) => {
    vi.stubGlobal('SpeechRecognition', MockDictationRecognition);
    const user = userEvent.setup();
    renderConversation();
    const textbox = screen.getByRole('textbox', { name: 'Message Jarvis' });
    await user.type(textbox, 'Remember');
    await user.click(screen.getByRole('button', { name: 'Dictate' }));
    const recognition = MockDictationRecognition.instance;
    recognition.stop.mockImplementation(() => {});
    act(() => recognition.emitTranscript('the launch'));
    await user.click(screen.getByRole('button', { name: 'Stop dictation' }));
    await user.click(screen.getByRole('button', { name: 'Stop dictation' }));
    expect(recognition.stop).toHaveBeenCalledTimes(1);
    act(() => {
      recognition.onerror?.({ error } as Event & { error: string });
      recognition.emitTranscript('tomorrow');
      recognition.onend?.();
    });
    expect(textbox).toHaveProperty('value', 'Remember the launch tomorrow');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop dictation' })).toBeNull();
    expect(sendChatTurn).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Dictate' }));
    act(() => {
      recognition.onerror?.({ error: 'aborted' } as Event & { error: string });
      recognition.emitTranscript('stale result');
      recognition.onend?.();
    });
    expect(screen.getByRole('button', { name: 'Stop dictation' })).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(textbox).toHaveProperty('value', 'Remember the launch tomorrow');
  });

  it.each(['not-allowed', 'network'])('preserves genuine %s failures after stop', async (error) => {
    vi.stubGlobal('SpeechRecognition', MockDictationRecognition);
    const user = userEvent.setup();
    renderConversation();
    await user.click(screen.getByRole('button', { name: 'Dictate' }));
    const recognition = MockDictationRecognition.instance;
    recognition.stop.mockImplementation(() => {});
    act(() => recognition.emitTranscript('Keep this'));
    await user.click(screen.getByRole('button', { name: 'Stop dictation' }));
    act(() => {
      recognition.onerror?.({ error } as Event & { error: string });
      recognition.onend?.();
    });
    expect(screen.getByRole('alert')).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveProperty('value', 'Keep this');
    expect(screen.queryByRole('button', { name: 'Stop dictation' })).toBeNull();
  });

  it('uses WebKit-prefixed speech recognition when the standard API is unavailable', async () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', MockDictationRecognition);
    const user = userEvent.setup();
    renderConversation(0, undefined, vi.fn(), undefined, true);
    const textbox = screen.getByRole('textbox', { name: 'Message Jarvis' });
    await user.type(textbox, 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Dictate' }));
    expect(MockDictationRecognition.instance.lang).toBe('en-US');
    act(() => MockDictationRecognition.instance.emitTranscript('from WebKit'));
    expect(textbox).toHaveProperty('value', 'Keep this draft from WebKit');
    expect(sendChatTurn).not.toHaveBeenCalled();
  });

  it('shows a clear disabled explanation when browser dictation is unavailable', () => {
    renderConversation();
    expect(screen.getByRole('button', { name: 'Dictate' })).toHaveProperty('disabled', true);
    expect(screen.getByText("Dictation isn't supported in this browser.")).not.toBeNull();
  });

  it('explains denied microphone permission without changing the draft', async () => {
    vi.stubGlobal('SpeechRecognition', MockDictationRecognition);
    const user = userEvent.setup();
    renderConversation();
    const textbox = screen.getByRole('textbox', { name: 'Message Jarvis' });
    await user.type(textbox, 'Keep this');
    await user.click(screen.getByRole('button', { name: 'Dictate' }));
    act(() => MockDictationRecognition.instance.onerror?.({ error: 'not-allowed' } as Event & { error: string }));
    expect(screen.getByRole('alert').textContent).toContain('Microphone permission was denied');
    expect(screen.getByRole('alert').closest('.conversation-input')).toBeNull();
    expect(textbox).toHaveProperty('value', 'Keep this');
    expect(sendChatTurn).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps Plus visual and keyboard order with Attach nearest the trigger (phone=%s)', async (phone) => {
    const user = userEvent.setup();
    renderConversation(0, undefined, vi.fn(), undefined, phone);
    const plus = screen.getByRole('button', { name: 'More options' });
    await user.click(plus);
    const items = screen.getAllByRole('menuitem');
    expect(items.map(item => item.textContent)).toEqual(['Language', 'Voice', 'Attach file or photo']);
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(items[2]);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(items[1]);
    expect(items[1]?.querySelector('svg rect')).toBeNull();
    expect(screen.getByRole('button', { name: 'Dictate' }).querySelector('svg rect')).not.toBeNull();
    await user.keyboard('{Home}{ArrowRight}');
    expect(screen.getByRole('menu', { name: 'Language' })).not.toBeNull();
    await user.keyboard('{Escape}{Escape}');
    expect(document.activeElement).toBe(plus);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('starts the existing realtime Voice session from the plus menu on phones', async () => {
    const user = userEvent.setup();
    renderConversation(0, undefined, vi.fn(), undefined, true);
    expect(document.querySelector('.composer-more')?.getAttribute('data-align')).toBe('start');
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Voice' }));
    expect(await screen.findByRole('button', { name: 'End voice' })).not.toBeNull();
    expect(voiceSessions).toHaveLength(1);
  });

  it.each(['image', 'caption'] as const)('shows the completed %s path on its user turn without inferring from a frame reference', async visualPath => {
    const user = userEvent.setup();
    const camera: CameraController = { sharing: true, conversation: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => true), stop: vi.fn(), inspect: vi.fn(),
      inspectTurn: vi.fn(async () => ({ source: 'camera' as const, capturedAt: userMessage.at, question: 'Count.', description: 'A hand.', frameId: 'opaque' })) };
    sendChatTurn.mockImplementation(async (...args: unknown[]) => {
      const onUser = args[4] as (value: typeof userMessage) => void;
      onUser({ ...userMessage, text: 'Count.' });
      return { ...assistantMessage, visualResult: { visualPath } };
    });
    renderConversation(0, camera);
    await user.type(screen.getByRole('textbox', { name: 'Message Jarvis' }), 'Count.');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const text = visualPath === 'image' ? 'Image supplied to Jarvis for this turn.'
      : 'Caption only - no image supplied to Jarvis for this turn.';
    const status = await screen.findByText(text);
    expect(status.closest('[data-speaker]')?.getAttribute('data-speaker')).toBe('dan');
    expect(screen.getAllByText(text)).toHaveLength(1);
  });

  it('shows persisted visual-path evidence but leaves legacy history unlabelled', async () => {
    loadConversationHistory.mockResolvedValue({ messages: [
      { ...message, id: '40', role: 'dan', visualResult: { visualPath: 'caption', visualReason: 'image_input_unverified' } },
      message,
    ], nextCursor: null });
    renderConversation();
    expect(await screen.findByText('Caption only - no image supplied to Jarvis for this turn. Model image support has not been verified.')).not.toBeNull();
    expect(screen.queryByText('Image supplied to Jarvis for this turn.')).toBeNull();
  });

  it('sends Factory messages through the existing queue and only focuses explicit voice start', async () => {
    const user = userEvent.setup();
    sendChatTurn.mockResolvedValue(assistantMessage);
    render(
      <ConversationIntentProvider>
        <JarvisActivityProvider>
          <MemoryRouter>
            <VoiceWorkspaceContext.Provider value={{ onVoiceActiveChange: vi.fn() }}>
              <ConversationHistory client={client} getAccessToken={getAccessToken} config={config} />
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

  it('shows task links but no tool chips once a reply is delivered', async () => {
    loadConversationHistory.mockResolvedValue({
      messages: [message, { ...message, id: '43', role: 'dan', text: 'Sure.', toolCalls: [] }],
      nextCursor: null,
    });
    renderConversation();

    expect(await screen.findByText('I started the task.')).not.toBeNull();
    expect(screen.getByText('Sure.')).not.toBeNull();
    expect(screen.getByText('Voice · 2.5 voice minutes')).not.toBeNull();
    expect(screen.queryByText(/Chat · English/)).toBeNull();
    expect(screen.getAllByText(/voice minutes/u)).toHaveLength(1);
    expect(screen.queryByTitle('factory_create_task · done')).toBeNull();
    expect(screen.getByRole('link', { name: 'Task #77' }).getAttribute('href')).toBe('/factory/tasks/77');
  });

  it('keeps the visible message time relative and formats its absolute tooltip', async () => {
    vi.setSystemTime(new Date('2026-10-03T12:05:00.000Z'));
    loadConversationHistory.mockResolvedValue({ messages: [message], nextCursor: null });
    renderConversation();

    const time = await screen.findByText('5 minutes ago');
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('title')).toBe('3 Oct 2026, 12:00');
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
    expect(loadImageArtifactUrl).toHaveBeenCalledWith(getAccessToken, config, artifactId, expect.any(AbortSignal));
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

  it.each(['- Protein: 10 g\n- Calories: 200 kcal\n- Fat: 0 g',
    '1. Protein: 10 g\n2. Calories: 200 kcal\n3. Fat: 0 g'])('renders nutrition as a list in saved voice history: %s', async nutrition => {
    loadConversationHistory.mockResolvedValue({ messages: [{ ...message, channel: 'voice', role: 'jarvis',
      text: `Checked it.\n\nEstimated nutrition:\n${nutrition}`, toolCalls: [] }], nextCursor: null });
    renderConversation();
    const item = await screen.findByText('Protein: 10 g');
    expect(item.tagName).toBe('LI');
    expect(['UL', 'OL']).toContain(item.parentElement?.tagName);
    expect(item.parentElement?.textContent).toContain('Calories: 200 kcal');
    expect(item.parentElement?.textContent).toContain('Fat: 0 g');
  });

  it('renders the same booking table during streaming, completion and persisted-history reload', async () => {
    const text = [
      '**Two synthetic bookings** before 1 July 2031:',
      '',
      '| Hotel | Check-in | Check-out | Price |',
      '|---|---|---|---|',
      '| Fixture Hotel North | 14 May, 15:00 | 15 May, 11:00 | 1,200 DKK |',
      '| Fixture Hotel South | 28 Jun, 16:00 | 29 Jun, 12:00 | 1,800 DKK |',
      '',
      'All times are local.',
    ].join('\n');
    let finish!: () => void;
    sendChatTurn.mockImplementation(async (...args: unknown[]) => {
      (args[4] as (value: typeof userMessage) => void)(userMessage);
      const delta = args[5] as (value: string) => void;
      for (const fragment of text.split(/(?<=\n)/u)) delta(fragment);
      await new Promise<void>(resolve => { finish = resolve; });
      return { ...assistantMessage, text };
    });
    const view = renderConversation();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'Show bookings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    await act(async () => { finish(); });
    expect(screen.getAllByRole('table')).toHaveLength(1);
    view.unmount();
    loadConversationHistory.mockResolvedValue({ messages: [{ ...message, ...assistantMessage, channel: 'chat', text, toolCalls: [] }], nextCursor: null });
    renderConversation();
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.getByRole('cell', { name: '15 May, 11:00' })).toBeTruthy();
    expect(screen.getByText('All times are local.')).toBeTruthy();
  });

  it('keeps a held-open streamed table at latest across growth unless the reader scrolls into history', async () => {
    let delta!: (text: string) => void;
    let finish!: () => void;
    let streamed = '';
    let settled = false;
    sendChatTurn.mockImplementation(async (_client, _config, _session, _text, onUser, onDelta) => {
      onUser(userMessage);
      delta = text => { streamed += text; onDelta(text); };
      await new Promise<void>(resolve => { finish = resolve; });
      settled = true;
      return { ...assistantMessage, text: streamed };
    });
    const tailGaps: number[] = [];
    function Readback({ version }: { version: number }) {
      useLayoutEffect(() => {
        if (version === 0) return;
        const transcript = screen.getByLabelText('Conversation history');
        tailGaps.push(transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop);
        transcript.dispatchEvent(new Event('scroll'));
      }, [version]);
      return (
        <JarvisActivityProvider><MemoryRouter>
          <VoiceWorkspaceContext.Provider value={{ onVoiceActiveChange: vi.fn() }}>
            <ConversationHistory client={client} getAccessToken={getAccessToken} config={config} />
          </VoiceWorkspaceContext.Provider>
        </MemoryRouter></JarvisActivityProvider>
      );
    }
    const view = render(<Readback version={0} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'Show bookings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledOnce());
    const transcript = screen.getByLabelText('Conversation history');
    let height = 600;
    let top = 300;
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, get: () => height });
    Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(transcript, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => { top = Math.max(0, Math.min(value, height - 300)); },
    });
    fireEvent.scroll(transcript);
    height = 1000;
    act(() => {
      delta('| Hotel | Check-in |\n|---|---|\n| Fixture Hotel North | 14 May 2031 at 15:00 |');
      view.rerender(<Readback version={1} />);
    });
    height = 1250;
    act(() => {
      delta('\n| Fixture Hotel South | 28 June 2031 at 16:00 |');
      view.rerender(<Readback version={2} />);
    });
    expect(tailGaps).toEqual([0, 0]);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    transcript.scrollTop = 100;
    fireEvent.scroll(transcript);
    height = 1600;
    act(() => {
      delta('\n| Fixture Hotel West | 30 June 2031 at 14:00 |');
      view.rerender(<Readback version={3} />);
    });
    height = 1750;
    act(() => {
      delta('\n\nTimes are local in this synthetic fixture.');
      view.rerender(<Readback version={4} />);
    });
    expect(tailGaps).toEqual([0, 0, 1200, 1350]);
    expect(transcript.scrollTop).toBe(100);
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
    expect(settled).toBe(false);
    await act(async () => { finish(); });
    expect(settled).toBe(true);
  });

  it('shows loading and empty states', async () => {
    let resolve: ((value: { messages: []; nextCursor: null }) => void) | undefined;
    loadConversationHistory.mockReturnValue(new Promise((done) => { resolve = done; }));
    renderConversation();

    expect(screen.getByRole('status').textContent).toContain('Loading conversation history.');
    expect(document.querySelector('.conversation-loading .skeleton-lines')).not.toBeNull();
    expect(document.querySelector('.loader-core')).toBeNull();
    resolve?.({ messages: [], nextCursor: null });
    expect(await screen.findByRole('heading', { name: 'What’s on your mind?' })).not.toBeNull();
  });

  it('makes shell history available immediately and loads messages inside its window', async () => {
    let resolve!: (page: { messages: []; nextCursor: null }) => void;
    loadConversationHistory.mockReturnValue(new Promise(done => { resolve = done; }));
    const host = document.createElement('div');
    document.body.append(host);
    const setAvailable = vi.fn();
    render(
      <ConversationWindowContext.Provider value={{ element: host, setAvailable, open: true, setOpen: vi.fn() }}>
        <JarvisActivityProvider><MemoryRouter><VoiceWorkspaceContext.Provider value={{ onVoiceActiveChange: vi.fn() }}>
          <ConversationHistory client={client} getAccessToken={getAccessToken} config={config} />
        </VoiceWorkspaceContext.Provider></MemoryRouter></JarvisActivityProvider>
      </ConversationWindowContext.Provider>,
    );
    expect(setAvailable).toHaveBeenLastCalledWith(true);
    expect(host.querySelector('.skeleton-lines')).not.toBeNull();
    expect(host.textContent).toContain('Loading conversation history.');
    expect(screen.getByLabelText('Conversation history').getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('.conversation-dock .skeleton-lines')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).not.toBeNull();
    await act(async () => resolve({ messages: [], nextCursor: null }));
    expect(setAvailable).toHaveBeenLastCalledWith(true);
    expect(host.textContent).toContain('No messages yet.');
    expect(screen.getByLabelText('Conversation history').getAttribute('aria-busy')).toBe('false');
    host.remove();
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

    expect((await screen.findByRole('alert')).textContent).toContain('History unavailable');
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
    expect(loadConversationHistory).toHaveBeenLastCalledWith(getAccessToken, config, '40');
  });

  it.each([null, '40'])('retries failed visual metadata refresh rather than older history with cursor %s', async nextCursor => {
    const content = (historyRefresh: number) => (
      <JarvisActivityProvider>
        <MemoryRouter>
          <ConversationHistory client={client} getAccessToken={getAccessToken} config={config} historyRefresh={historyRefresh} />
        </MemoryRouter>
      </JarvisActivityProvider>
    );
    loadConversationHistory.mockReset().mockResolvedValueOnce({ messages: [message], nextCursor })
      .mockRejectedValueOnce(new Error('Jarvis returned an invalid visual input status.'))
      .mockResolvedValueOnce({ messages: [message], nextCursor });
    const view = render(content(0));
    await screen.findByText(message.text);
    view.rerender(content(1));
    await screen.findByRole('alert');
    expect(screen.getByText(message.text)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(loadConversationHistory).toHaveBeenCalledTimes(3));
    expect(loadConversationHistory).toHaveBeenLastCalledWith(getAccessToken, config);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retries an older-page visual metadata failure using its original cursor', async () => {
    loadConversationHistory.mockReset().mockResolvedValueOnce({ messages: [message], nextCursor: '40' })
      .mockRejectedValueOnce(new Error('Jarvis returned an invalid visual input status.'))
      .mockResolvedValueOnce({ messages: [{ ...message, id: '40', text: 'Earlier turn.' }], nextCursor: null });
    renderConversation();
    await screen.findByText(message.text);
    fireEvent.click(screen.getByRole('button', { name: 'Load older history' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Earlier turn.');
    expect(loadConversationHistory).toHaveBeenLastCalledWith(getAccessToken, config, '40');
  });

  it('reloads persisted history after a voice session ends', async () => {
    loadConversationHistory.mockResolvedValue({ messages: [message], nextCursor: null });
    const view = renderConversation();
    expect(await screen.findByText('I started the task.')).not.toBeNull();

    view.rerender(
      <JarvisActivityProvider>
        <MemoryRouter>
          <ConversationHistory client={client} getAccessToken={getAccessToken} config={config} historyRefresh={1} />
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
    expect(createChatSession).toHaveBeenCalledWith(getAccessToken, config, 'en', expect.any(AbortSignal));
    expect(sendChatTurn).toHaveBeenCalledWith(
      getAccessToken,
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
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function),
      undefined,
      expect.any(Function),
    );
  });

  it('shows the exact staged food invitation in chat before accepting a new reply and committed receipt', async () => {
    let finish!: (value: typeof assistantMessage) => void;
    sendChatTurn.mockImplementation(async (...args: unknown[]) => {
      (args[4] as (message: typeof userMessage) => void)(userMessage);
      (args[14] as (invitation: unknown) => void)({
        id: 'a'.repeat(43),
        summary: 'Synthetic portion\nNutrition:\n- Protein: 10 g\n- Calories: 200 kcal\n- Fat: 20 g\nUncertainty: estimated grams. Nothing has changed.',
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      });
      return new Promise(resolve => { finish = resolve; });
    });
    renderConversation();
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: 'Estimate this synthetic food portion.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const invitation = await screen.findByRole('status', { name: 'Food estimate awaiting your reply' });
    expect(invitation.textContent).toContain('Synthetic portion');
    expect([...invitation.querySelectorAll('ul > li')].map(item => item.textContent)).toEqual(['Protein: 10 g', 'Calories: 200 kcal', 'Fat: 20 g']);
    expect(invitation.textContent).toContain('Uncertainty: estimated grams');
    expect(invitation.textContent).toContain('Would you like to log this estimate? Reply here');
    expect(screen.queryByText('Logged Synthetic portion: 200 kcal.')).toBeNull();
    fireEvent.change(input, { target: { value: 'Log it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(steerChatTurn).toHaveBeenCalled());
    expect(steerChatTurn.mock.calls[0]?.[3]).toBe('Log it');
    await act(async () => finish({ ...assistantMessage, text: 'Logged Synthetic portion: 200 kcal.' }));
    expect(await screen.findByText('Logged Synthetic portion: 200 kcal.')).not.toBeNull();
    expect(screen.queryByRole('status', { name: 'Food estimate awaiting your reply' })).toBeNull();
    expect(sendChatTurn).toHaveBeenCalledOnce();
  });

  it('removes a withdrawn food invitation without treating it as a committed result', async () => {
    let publish!: (invitation: unknown) => void;
    let finish!: (value: typeof assistantMessage) => void;
    sendChatTurn.mockImplementation(async (...args: unknown[]) => {
      (args[4] as (message: typeof userMessage) => void)(userMessage);
      publish = args[14] as typeof publish;
      return new Promise(resolve => { finish = resolve; });
    });
    renderConversation();
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: 'Estimate this portion.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(publish).toBeDefined());
    await act(async () => publish({ id: 'a'.repeat(43), summary: 'Synthetic portion: 200 kcal.',
      expiresAt: new Date(Date.now() + 120_000).toISOString() }));
    expect(screen.getByRole('status', { name: 'Food estimate awaiting your reply' })).not.toBeNull();
    await act(async () => publish(null));
    expect(screen.queryByRole('status', { name: 'Food estimate awaiting your reply' })).toBeNull();
    expect(steerChatTurn).not.toHaveBeenCalled();
    await act(async () => finish({ ...assistantMessage, text: 'No food was logged.' }));
    expect(await screen.findByText('No food was logged.')).not.toBeNull();
  });

  it('shows the acknowledgment separately while tools run and replaces it with the final answer', async () => {
    let finish!: (value: typeof assistantMessage) => void;
    const acknowledgment = "I'll compare your saved targets.";
    sendChatTurn.mockImplementation(async (...args: unknown[]) => {
      const onUser = args[4] as (message: typeof userMessage) => void;
      const onDelta = args[5] as (text: string) => void;
      const onAcknowledgment = args[13] as (text: string) => void;
      onUser(userMessage);
      onDelta(acknowledgment);
      onAcknowledgment(acknowledgment);
      return new Promise((resolve) => { finish = resolve; });
    });
    renderConversation();
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: 'Compare my targets.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect((await screen.findByLabelText("Jarvis's initial reply")).textContent).toContain(
      acknowledgment,
    );
    expect(sendChatTurn.mock.calls[0]?.[11]).toBeUndefined();
    expect(sendChatTurn.mock.calls[0]?.[12]).toBeUndefined();
    expect(sendChatTurn.mock.calls[0]?.[13]).toEqual(expect.any(Function));
    expect(screen.queryByLabelText('Jarvis reply in progress')).toBeNull();
    expect(screen.queryByText('Jarvis is thinking…')).toBeNull();
    await act(async () => finish(assistantMessage));

    expect(await screen.findByText(assistantMessage.text)).not.toBeNull();
    expect(screen.queryByLabelText("Jarvis's initial reply")).toBeNull();
  });

  it('keeps the acknowledgment with an honest failure after tool work', async () => {
    const acknowledgment = "I'll check your saved targets.";
    sendChatTurn.mockImplementationOnce(async (...args: unknown[]) => {
      const onUser = args[4] as (message: typeof userMessage) => void;
      const onDelta = args[5] as (text: string) => void;
      const onAcknowledgment = args[13] as (text: string) => void;
      onUser(userMessage);
      onDelta(acknowledgment);
      onAcknowledgment(acknowledgment);
      throw new Error('The reply could not be completed.');
    });
    renderConversation();
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: 'Check my saved targets.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(acknowledgment)).not.toBeNull();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The reply could not be completed.',
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
    chooseLanguage('Danish');
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
    expect(sendChatTurn.mock.calls[1]?.slice(2, 4)).toEqual([{ id: '41', language: 'en' }, 'Second']);
    expect(screen.getByText('1 message queued')).not.toBeNull();
    await act(async () => finishes[1]!());
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledTimes(3));
    expect(sendChatTurn.mock.calls[2]?.slice(2, 4)).toEqual([{ id: '41', language: 'da' }, 'Third']);
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
    expect(error.closest('[data-speaker]')?.getAttribute('data-speaker')).toBe('jarvis');
    expect(screen.getByText(userMessage.text).closest('[data-speaker]')?.getAttribute('data-speaker')).toBe('dan');
    expect(screen.getByText('Partial reply, interrupted:')).not.toBeNull();
    expect(sendChatTurn.mock.calls[1]?.[3]).toBe('Next after failure');
    await act(async () => finish({ ...assistantMessage, id: '54' }));
    expect(screen.getByRole('alert')).toBe(error);
  });

  it.each([
    { saved: true, partial: 'Partial answer' },
    { saved: true, partial: '' },
    { saved: false, partial: 'Partial answer' },
    { saved: false, partial: '' },
  ])('separates user text from assistant failure (saved: $saved, partial: "$partial")', async ({ saved, partial }) => {
    sendChatTurn.mockImplementationOnce(async (_client, _config, _session, _text, onUser, onDelta) => {
      if (saved) onUser(userMessage);
      if (partial) onDelta(partial);
      throw new Error('Reply failed.');
    });
    renderConversation();
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: userMessage.text } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const error = await screen.findByRole('alert');
    const assistant = error.closest('.conversation-message');
    const user = screen.getByText(userMessage.text, { selector: 'p' }).closest('.conversation-message');
    expect(assistant?.getAttribute('data-speaker')).toBe('jarvis');
    expect(user?.getAttribute('data-speaker')).toBe('dan');
    expect(user?.querySelector('[role="alert"]')).toBeNull();
    expect(assistant?.textContent).not.toContain(userMessage.text);
    expect(user?.nextElementSibling).toBe(assistant);
    expect(assistant?.querySelector('.message-author')?.textContent).toBe('Jarvis');
    if (partial) {
      expect(screen.getByText(partial).closest('.conversation-message')).toBe(assistant);
      expect(user?.textContent).not.toContain(partial);
    } else {
      expect(screen.queryByText('Partial reply, interrupted:')).toBeNull();
    }
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
      getAccessToken, config, session, steeringMessage.text, 'en',
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
        <ConversationHistory client={client} getAccessToken={getAccessToken} config={config} historyRefresh={historyRefresh} />
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
    expect(loadConversationHistory).toHaveBeenLastCalledWith(getAccessToken, config, '40');
  });

  it('resets the camera idle timer on unrelated chat turns without uploading an unsolicited frame', async () => {
    const camera: CameraController = {
      sharing: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(), recordActivity: vi.fn(),
    };
    sendChatTurn.mockResolvedValue(assistantMessage);
    renderConversation(0, camera);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message Jarvis' }), {
      target: { value: 'How is the weather?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalled());
    expect(camera.recordActivity).toHaveBeenCalledOnce();
    expect(camera.inspect).not.toHaveBeenCalled();
  });

  it('captures arbitrary camera-on turns when they execute, queues instead of steering, and forwards fresh handles', async () => {
    const camera: CameraController = {
      sharing: true, conversation: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(),
      inspectTurn: vi.fn(async (_id: string, question: string) => ({
        source: 'camera' as const, capturedAt: '2026-10-11T19:23:33.000Z', description: 'Fixture frame.', question, frameId: 'fresh_fixture',
      })),
    };
    let finish!: (value: typeof assistantMessage) => void;
    sendChatTurn.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(assistantMessage);
    renderConversation(0, camera);
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    const send = (text: string) => {
      fireEvent.change(input, { target: { value: text } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    };
    send('how many fingers am i holing up?');
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledOnce());
    send('And now?');
    expect(camera.inspectTurn).toHaveBeenCalledOnce();
    expect(steerChatTurn).not.toHaveBeenCalled();
    await act(async () => { finish(assistantMessage); });
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledTimes(2));
    expect(camera.inspectTurn).toHaveBeenNthCalledWith(2, session.id, 'And now?', expect.any(AbortSignal));
    expect(sendChatTurn.mock.calls[1]?.[7]).toBeUndefined();
    expect(sendChatTurn.mock.calls[1]?.[12]).toMatchObject({ question: 'And now?', frameId: 'fresh_fixture', source: 'camera' });
    expect(camera.inspect).not.toHaveBeenCalled();
  });

  it('does not upload an ordinary camera-off turn with conversation enabled', async () => {
    const camera: CameraController = {
      sharing: false, conversation: true, starting: false, inspecting: false, error: '',
      start: vi.fn(async () => {}), stop: vi.fn(), inspect: vi.fn(), inspectTurn: vi.fn(),
    };
    sendChatTurn.mockResolvedValue(assistantMessage);
    renderConversation(0, camera);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'And now?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledOnce());
    expect(camera.inspectTurn).not.toHaveBeenCalled();
    expect(sendChatTurn.mock.calls[0]?.[12]).toBeUndefined();
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
      recordActivity: vi.fn(),
    };
    sendChatTurn.mockResolvedValue(assistantMessage);
    renderConversation(0, camera);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Message Jarvis' }), {
      target: { value: 'What am I holding?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(sendChatTurn).toHaveBeenCalled());
    expect(camera.recordActivity).toHaveBeenCalledOnce();
    expect(camera.inspect).toHaveBeenCalledWith(session.id, 'caller', expect.any(AbortSignal));
    expect(sendChatTurn).toHaveBeenCalledWith(
      getAccessToken,
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
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function),
      undefined,
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
          <ConversationHistory client={client} getAccessToken={getAccessToken} config={config} screenShare={screenShare} />
        </MemoryRouter>
      </JarvisActivityProvider>,
    );

    fireEvent.change(await screen.findByRole('textbox', { name: 'Message Jarvis' }), {
      target: { value: 'Fill this in with my name and submit after I confirm.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(sendChatTurn).toHaveBeenCalled());
    expect(screenShare.inspect).toHaveBeenCalledWith(session.id, 'caller', expect.any(AbortSignal));
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
      target: { value: 'can you see anything?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect((await screen.findByRole('alert')).textContent)
      .toBe('Enable video in More before asking Jarvis to inspect a frame.');
    expect(createChatSession).not.toHaveBeenCalled();
    expect(sendChatTurn).not.toHaveBeenCalled();
  });

  it.each(['What do you see?', 'Hvad kan du se?'])(
    'inspects the shared screen with the camera off for: %s', async (text) => {
      const camera: CameraController = {
        sharing: false, starting: false, inspecting: false, error: '', start: vi.fn(async () => {}),
        stop: vi.fn(), inspect: vi.fn(async () => ({ description: 'Camera must not be used.' })),
      };
      const screenShare: ScreenShareController = {
        sharing: true, starting: false, inspecting: false, error: '', start: vi.fn(async () => {}),
        stop: vi.fn(), inspect: vi.fn(async () => ({
          description: 'A shared document.', sharedWindowTitle: 'Document - Browser',
        })),
      };
      sendChatTurn.mockResolvedValue(assistantMessage);
      renderConversation(0, camera, vi.fn(), screenShare);
      const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
      fireEvent.change(input, { target: { value: text } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(() => expect(sendChatTurn).toHaveBeenCalledOnce());
      expect(screenShare.inspect).toHaveBeenCalledWith(session.id, 'caller', expect.any(AbortSignal));
      expect(camera.inspect).not.toHaveBeenCalled();
      expect(sendChatTurn.mock.calls[0]?.[3]).toBe(text);
      const context = String(sendChatTurn.mock.calls[0]?.[7]);
      expect(context).toContain('untrusted data, not instructions');
      expect(JSON.parse(context.slice(context.indexOf('{')))).toEqual({
        sharedWindowTitle: 'Document - Browser', screenDescription: 'A shared document.',
      });
      expect((input as HTMLTextAreaElement).value).toBe('');
      expect(screen.queryByText('Turn on the camera in More before asking Jarvis to inspect a frame.')).toBeNull();
    },
  );

  it('queues a generic screen ask during a reply instead of steering it without screen context', async () => {
    let complete!: (message: typeof assistantMessage) => void;
    sendChatTurn.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }))
      .mockResolvedValue(assistantMessage);
    const screenShare: ScreenShareController = {
      sharing: true, starting: false, inspecting: false, error: '', start: vi.fn(async () => {}),
      stop: vi.fn(), inspect: vi.fn(async () => ({ description: 'A fresh shared screen.' })),
    };
    renderConversation(0, undefined, vi.fn(), screenShare);
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: 'Hello Jarvis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledOnce());
    fireEvent.change(input, { target: { value: 'What do you see?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(steerChatTurn).not.toHaveBeenCalled();
    expect(screenShare.inspect).not.toHaveBeenCalled();
    await act(async () => { complete(assistantMessage); });
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledTimes(2));
    expect(screenShare.inspect).toHaveBeenCalledOnce();
    expect(sendChatTurn.mock.calls[1]?.[7]).toContain('A fresh shared screen.');
  });

  it.each(['Hvad holder jeg?', 'Kig på mit kamera. Hvad kan du se?', 'Kan du se mig?',
    'can you see anything?', 'What do you see?', 'Kan du se noget?'])(
    'inspects an explicit English or Danish camera request: %s', async (text) => {
      const camera: CameraController = {
        sharing: true, starting: false, inspecting: false, error: '', start: vi.fn(async () => {}),
        stop: vi.fn(), inspect: vi.fn(async () => ({ description: 'Fixture camera description.' })),
      };
      sendChatTurn.mockResolvedValue(assistantMessage);
      renderConversation(0, camera);
      fireEvent.change(await screen.findByRole('textbox', { name: 'Message Jarvis' }), { target: { value: text } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(sendChatTurn).toHaveBeenCalled());
      expect(camera.inspect).toHaveBeenCalledOnce();
      expect(sendChatTurn.mock.calls[0]?.[7]).toBe('Fixture camera description.');
    },
  );

  it('keeps camera controls out of the composer, and reports capture failure without a text-only turn', async () => {
    const camera: CameraController = {
      sharing: true, starting: false, inspecting: false, error: '', facing: 'user',
      start: vi.fn(async () => {}), stop: vi.fn(), switchCamera: vi.fn(async () => {}),
      inspect: vi.fn(async () => { throw new Error('Camera frame failed. Try again.'); }),
    };
    renderConversation(0, camera);
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    expect(screen.queryByText('Front camera on')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Camera off' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch to back camera' })).toBeNull();
    expect(camera.switchCamera).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Look now' })).toBeNull();
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    expect(camera.inspect).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe('Keep this draft');
    fireEvent.change(input, { target: { value: 'can you see anything?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const error = await screen.findByText('Camera frame failed. Try again.');
    expect(error.closest('.conversation-message')?.getAttribute('data-speaker')).toBe('jarvis');
    expect(sendChatTurn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Turn camera off' }));
    expect(camera.stop).toHaveBeenCalledOnce();
  });

  it('queues a camera ask during a reply instead of steering it without an image', async () => {
    let complete!: (message: typeof assistantMessage) => void;
    sendChatTurn.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }))
      .mockResolvedValue(assistantMessage);
    const camera: CameraController = {
      sharing: true, starting: false, inspecting: false, error: '', start: vi.fn(async () => {}),
      stop: vi.fn(), inspect: vi.fn(async () => ({ description: 'A fresh frame.' })),
    };
    renderConversation(0, camera);
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: 'Hello Jarvis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledOnce());
    fireEvent.change(input, { target: { value: 'can you see anything?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(steerChatTurn).not.toHaveBeenCalled();
    expect(camera.inspect).not.toHaveBeenCalled();
    await act(async () => { complete(assistantMessage); });
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledTimes(2));
    expect(camera.inspect).toHaveBeenCalledOnce();
    expect(sendChatTurn.mock.calls[1]?.[7]).toBe('A fresh frame.');
  });

  it('derives chat activity from runtime events and keeps it across a conversation unmount', async () => {
    const finishers: Array<(value: typeof assistantMessage) => void> = [];
    sendChatTurn.mockImplementation(async () => new Promise((resolve) => { finishers.push(resolve); }));
    const content = (showConversation: boolean) => (
      <JarvisActivityProvider>
        <MemoryRouter>
          <ActivityProbe />
          {showConversation && <ConversationHistory client={client} getAccessToken={getAccessToken} config={config} />}
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

  it('takes the send icon off again for every accepted message', async () => {
    sendChatTurn.mockResolvedValue(assistantMessage);
    const user = userEvent.setup();
    renderConversation();
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    const glyph = () => screen.getByRole('button', { name: 'Send' }).querySelector('.composer-send-glyph');
    const resting = glyph();
    expect(resting).not.toBeNull();
    expect(resting?.hasAttribute('data-sent')).toBe(false);

    await user.type(input, 'One');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledTimes(1));
    const first = glyph();
    expect(first?.hasAttribute('data-sent')).toBe(true);
    expect(first).not.toBe(resting);

    await waitFor(() => expect(input).toHaveProperty('disabled', false));
    await user.type(input, 'Two');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledTimes(2));
    expect(glyph()?.hasAttribute('data-sent')).toBe(true);
    expect(glyph()).not.toBe(first);
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
      voice.onMicrophoneState?.('live');
      voice.onStatus('speaking', 'Jarvis is speaking.');
      voice.onStatus('listening', 'Listening for your voice.');
    });
    const statusLabel = screen.getByText('Listening');
    expect(statusLabel.closest('[role="status"]')?.getAttribute('aria-atomic')).toBe('true');
    expect(screen.getByText('Listening for your voice.')).not.toBeNull();
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
    createChatSession.mockResolvedValue({ ...session, language: 'da' });
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
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'English' }));
    expect(screen.getByRole('menuitemradio', { name: 'Danish' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('menuitemradio', { name: 'English' }).getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{ArrowUp}{Enter}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
    expect(selectedLanguage()).toBe('Danish');
    await user.click(input);
    await user.type(input, 'Hello');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(createChatSession).toHaveBeenCalledWith(getAccessToken, config, 'da', expect.any(AbortSignal)));
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
    const observers = new Map<Element, () => void>();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: () => void) {}
      observe = (element: Element) => { observers.set(element, this.callback); };
      disconnect = disconnect;
    });
    const view = renderConversation();
    const input = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    const height = vi.spyOn(input, 'scrollHeight', 'get').mockReturnValue(96);
    const box = vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ width: 390 } as DOMRect);
    act(() => observers.get(input)?.());
    expect(input.style.height).toBe('96px');
    height.mockReturnValue(144);
    act(() => observers.get(input)?.());
    expect(input.style.height).toBe('96px');
    box.mockReturnValue({ width: 200 } as DOMRect);
    act(() => observers.get(input)?.());
    expect(input.style.height).toBe('144px');
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
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
    expect(reply?.querySelector('time')?.getAttribute('title')).toBe('3 Oct 2026, 12:00');
    expect(screen.getByText('Sure.').closest('li')?.getAttribute('data-speaker')).toBe('dan');
  });

  const historyPair = [
    { ...message, id: '43', role: 'dan' as const, text: 'Hello Jarvis', toolCalls: [] },
    { ...message, id: '44', channel: 'chat' as const, text: 'I am ready.', toolCalls: [] },
  ];

  it('stays pinned to the end when a reply grows inside the transcript after it was added', async () => {
    loadConversationHistory.mockResolvedValue({ messages: historyPair, nextCursor: null });
    renderConversation();
    await screen.findByText('I am ready.');
    const transcript = screen.getByLabelText('Conversation history');
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1500 });
    const bubble = screen.getByText('I am ready.');
    await act(async () => { bubble.textContent = 'I am ready. Here is a much longer answer.'; await Promise.resolve(); });
    await waitFor(() => expect(transcript.scrollTop).toBe(1500));
  });

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

  it('keeps latest content visible through keyboard resizing without pulling a history reader to the bottom', async () => {
    const observers = new Map<Element, () => void>();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: () => void) {}
      observe = (element: Element) => { observers.set(element, this.callback); };
      disconnect = disconnect;
    });
    loadConversationHistory.mockResolvedValue({ messages: historyPair, nextCursor: null });
    const view = renderConversation();
    await screen.findByText('I am ready.');
    const transcript = screen.getByLabelText('Conversation history');
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 300 });
    act(() => observers.get(transcript)?.());
    expect(transcript.scrollTop).toBe(1200);
    transcript.scrollTop = 100;
    fireEvent.scroll(transcript);
    Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 150 });
    act(() => observers.get(transcript)?.());
    expect(transcript.scrollTop).toBe(100);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1400 });
    act(() => observers.get(transcript)?.());
    expect(transcript.scrollTop).toBe(1400);
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
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

  it('offers sharing in the More menu without separate look actions', async () => {
    renderConversation(0);
    await screen.findByRole('heading', { name: 'What’s on your mind?' });

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: /^Look at/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Language' })).not.toBeNull();
  });
});
