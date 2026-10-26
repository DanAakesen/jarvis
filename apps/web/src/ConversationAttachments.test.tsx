import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConversationHistory } from './ConversationHistory';
import { JarvisActivityProvider } from './activity-provider';
import { VoiceWorkspaceContext } from './voice-workspace-state';
import { AttachmentExpiredError } from './chat-attachments';

const { loadConversationHistory, createChatSession, sendChatTurn, uploadAttachment, loadAttachmentUrl, deleteAttachment } = vi.hoisted(() => ({
  loadConversationHistory: vi.fn(),
  createChatSession: vi.fn(),
  sendChatTurn: vi.fn(),
  uploadAttachment: vi.fn(),
  loadAttachmentUrl: vi.fn(),
  deleteAttachment: vi.fn(),
}));
vi.mock('./conversation-history', async (importOriginal) => ({
  ...await importOriginal<typeof import('./conversation-history')>(),
  loadConversationHistory, createChatSession, sendChatTurn,
}));
vi.mock('./chat-attachments', async (importOriginal) => ({
  ...await importOriginal<typeof import('./chat-attachments')>(),
  uploadAttachment, loadAttachmentUrl, deleteAttachment,
}));
vi.mock('./voice-client', () => ({
  BrowserVoiceClient: class {
    start() {}
    stop() {}
    playbackLevel = () => 0;
    inputLevel = () => 0;
    setMuted = vi.fn();
  },
}));

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };
const session = { id: '41', language: 'en' as const };
const fileId = '0b0f4a7e-3c1d-4f6a-8b2e-1a2b3c4d5e6f';
const reply = { id: '52', sessionId: '41', role: 'jarvis' as const, text: 'Done.', model: null, at: '2026-10-03T12:02:00.000Z' };
const NativeURL = URL;

function stubObjectUrl(url: string) {
  class TestURL extends NativeURL {
    static createObjectURL = vi.fn(() => url);
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal('URL', TestURL);
  return TestURL;
}

function renderConversation(phone = false) {
  return render(
    <JarvisActivityProvider>
      <MemoryRouter>
        <VoiceWorkspaceContext.Provider value={{ onVoiceActiveChange: vi.fn() }}>
          <ConversationHistory client={{} as never} config={config} phone={phone} />
        </VoiceWorkspaceContext.Provider>
      </MemoryRouter>
    </JarvisActivityProvider>,
  );
}

function pick(...files: File[]) {
  if (!screen.queryByRole('menu')) fireEvent.click(screen.getByRole('button', { name: 'More options' }));
  fireEvent.change(screen.getByTestId('attachment-input'), { target: { files } });
}

beforeEach(() => {
  vi.clearAllMocks();
  loadConversationHistory.mockResolvedValue({ messages: [], nextCursor: null });
  createChatSession.mockResolvedValue(session);
  sendChatTurn.mockResolvedValue(reply);
  deleteAttachment.mockResolvedValue(undefined);
  uploadAttachment.mockImplementation(async (_c, _cfg, file: File) => ({
    id: fileId, name: file.name, contentType: file.type, size: file.size, status: 'ready',
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('composer attachments', () => {
  it('uploads a picked file, shows its chip and sends its id with the message', async () => {
    renderConversation();
    await screen.findByRole('textbox', { name: 'Message Jarvis' });
    pick(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    const chips = await screen.findByRole('list', { name: 'Files to send' });
    expect(within(chips).getByText('notes.txt')).toBeTruthy();
    await waitFor(() => expect(within(chips).getByText(/Ready/u)).toBeTruthy());

    fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'Look' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalled());
    expect(sendChatTurn.mock.calls[0]![3]).toBe('Look');
    expect(sendChatTurn.mock.calls[0]![11]).toEqual([fileId]);
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Files to send' })).toBeNull());
  });

  it('makes Send wait for a pending upload and shows progress', async () => {
    let finish!: () => void;
    uploadAttachment.mockImplementationOnce((_c, _cfg, file: File, options: { onProgress: (n: number) => void }) =>
      new Promise((resolve) => {
        options.onProgress(0.4);
        finish = () => resolve({ id: fileId, name: file.name, contentType: file.type, size: file.size, status: 'ready' });
      }));
    renderConversation();
    await screen.findByRole('textbox', { name: 'Message Jarvis' });
    pick(new File(['x'], 'log.txt', { type: 'text/plain' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Jarvis' }), { target: { value: 'Check' } });
    expect(await screen.findByRole('progressbar', { name: 'Uploading log.txt' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message Jarvis' }), { key: 'Enter' });
    expect(sendChatTurn).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it.each([false, true])('keeps image pills inside the composer through upload and ready (phone=%s)', async (phone) => {
    const previewUrl = 'blob:preview/holiday.jpg';
    stubObjectUrl(previewUrl);
    let finish!: () => void;
    uploadAttachment.mockImplementationOnce((_c, _cfg, file: File, options: { onProgress: (n: number) => void }) =>
      new Promise((resolve) => {
        options.onProgress(0.4);
        finish = () => resolve({ id: fileId, name: file.name, contentType: file.type, size: file.size, status: 'ready' });
      }));
    renderConversation(phone);
    await screen.findByRole('textbox', { name: 'Message Jarvis' });
    pick(new File(['image'], 'holiday.jpg', { type: 'image/jpeg' }));
    const chips = await screen.findByRole('list', { name: 'Files to send' });
    expect(chips.closest('form')?.id).toBe('conversation-composer');
    expect(chips.closest('.conversation-input')).not.toBeNull();
    const chip = chips.querySelector('.attachment-chip');
    expect(chip?.classList.contains('attachment-chip--image')).toBe(true);
    expect(await within(chips).findByRole('img', { name: 'Preview of holiday.jpg' })).toHaveProperty('src', previewUrl);
    expect(within(chips).getByText('holiday.jpg')).toBeTruthy();
    expect(within(chips).getByRole('progressbar', { name: 'Uploading holiday.jpg' })).toBeTruthy();
    expect(within(chips).getByRole('button', { name: 'Remove holiday.jpg' })).toBeTruthy();
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    expect(chips.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    finish();
    await waitFor(() => expect(within(chips).queryByRole('progressbar')).toBeNull());
    expect(chips.closest('form')?.id).toBe('conversation-composer');
    expect(within(chips).getByText('holiday.jpg')).toBeTruthy();
    expect(within(chips).queryByText(/Ready|image\/jpeg/u)).toBeNull();
  });

  it('puts phone upload errors and selection problems above the composer while retaining removable pills inside', async () => {
    stubObjectUrl('blob:preview/failed.png');
    uploadAttachment.mockRejectedValueOnce(new Error('Synthetic upload failure'));
    renderConversation(true);
    pick(new File(['image'], 'failed.png', { type: 'image/png' }));
    const error = await screen.findByText('failed.png: Synthetic upload failure');
    expect(error.closest('.composer-feedback')).not.toBeNull();
    expect(error.closest('.conversation-input')).toBeNull();
    const chips = screen.getByRole('list', { name: 'Files to send' });
    expect(chips.closest('form')?.id).toBe('conversation-composer');
    expect(within(chips).queryByRole('alert')).toBeNull();
    fireEvent.click(within(chips).getByRole('button', { name: 'Remove failed.png' }));
    expect(screen.queryByText('failed.png: Synthetic upload failure')).toBeNull();
    pick(new File(['binary'], 'program.exe', { type: 'application/x-msdownload' }));
    const problem = await screen.findByRole('alert');
    expect(problem.closest('.composer-feedback')).not.toBeNull();
    expect(problem.closest('.conversation-input')).toBeNull();
  });

  it('restores an image preview after an unsaved send fails', async () => {
    const previewUrl = 'blob:preview/holiday.jpg';
    const TestURL = stubObjectUrl(previewUrl);
    const signedUrl = 'https://acct.blob.core.windows.net/x?sig=1';
    loadAttachmentUrl.mockResolvedValue(signedUrl);
    sendChatTurn.mockRejectedValueOnce(new Error('Could not send. Try again.'));
    renderConversation();
    await screen.findByRole('textbox', { name: 'Message Jarvis' });
    pick(new File(['image'], 'holiday.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByRole('img', { name: 'Preview of holiday.jpg' })).toHaveProperty('src', previewUrl);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Could not send. Try again.');
    await waitFor(() => expect(screen.getByRole('img', { name: 'Preview of holiday.jpg' })).toHaveProperty('src', signedUrl));
    expect(TestURL.revokeObjectURL).toHaveBeenCalledWith(previewUrl);
  });

  it('falls back to the uploaded image when a local preview fails before upload completes', async () => {
    const previewUrl = 'blob:preview/holiday.jpg';
    const signedUrl = 'https://acct.blob.core.windows.net/x?sig=1';
    stubObjectUrl(previewUrl);
    loadAttachmentUrl.mockResolvedValue(signedUrl);
    let finish!: () => void;
    uploadAttachment.mockImplementationOnce((_c, _cfg, file: File) =>
      new Promise((resolve) => {
        finish = () => resolve({ id: fileId, name: file.name, contentType: file.type, size: file.size, status: 'ready' });
      }));
    renderConversation();
    await screen.findByRole('textbox', { name: 'Message Jarvis' });
    pick(new File(['image'], 'holiday.jpg', { type: 'image/jpeg' }));
    fireEvent.error(await screen.findByRole('img', { name: 'Preview of holiday.jpg' }));
    finish();
    await waitFor(() => expect(screen.getByRole('img', { name: 'Preview of holiday.jpg' })).toHaveProperty('src', signedUrl));
    expect(loadAttachmentUrl).toHaveBeenCalledWith(expect.any(Function), config, fileId, expect.any(AbortSignal));
  });

  it('turns a pasted screenshot into an attachment and keeps pasted text', async () => {
    renderConversation();
    const box = await screen.findByRole('textbox', { name: 'Message Jarvis' });
    const shot = new File([new Uint8Array(4)], 'image.png', { type: 'image/png' });
    fireEvent.paste(box, { clipboardData: { files: [shot], getData: () => '' } });
    expect(await screen.findByRole('button', { name: /^Remove screenshot-\d{8}-\d{6}\.png$/u })).toBeTruthy();
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    fireEvent.paste(box, { clipboardData: { files: [shot], getData: () => 'plain text' } });
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
  });

  it('accepts dropped files', async () => {
    const { container } = renderConversation();
    await screen.findByRole('textbox', { name: 'Message Jarvis' });
    const section = container.querySelector('.conversation-history')!;
    const dropped = new File(['{}'], 'data.json', { type: 'application/json' });
    const dataTransfer = { types: ['Files'], files: [dropped], dropEffect: 'none' };
    fireEvent.dragEnter(section, { dataTransfer });
    expect(section.getAttribute('data-file-drag')).toBe('true');
    fireEvent.drop(section, { dataTransfer });
    expect(await screen.findByText('data.json')).toBeTruthy();
    expect(section.getAttribute('data-file-drag')).toBeNull();
  });

  it('explains wrong type, too large and too many files', async () => {
    renderConversation();
    await screen.findByRole('textbox', { name: 'Message Jarvis' });
    pick(new File(['x'], 'app.exe'));
    expect((await screen.findByRole('alert')).textContent).toContain('.exe files are not supported');
    pick(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }));
    expect((await screen.findByRole('alert')).textContent).toContain('10 MB or smaller');
    pick(...Array.from({ length: 6 }, (_, index) => new File(['x'], `f${index}.txt`, { type: 'text/plain' })));
    expect((await screen.findByRole('alert')).textContent).toContain('Only 5 files fit');
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(5));
  });

  it('reports an upload failure and removes a chip, deleting the private upload', async () => {
    uploadAttachment.mockRejectedValueOnce(new Error('The file is larger than the 20 MB limit.'));
    renderConversation();
    await screen.findByRole('textbox', { name: 'Message Jarvis' });
    pick(new File(['x'], 'a.txt', { type: 'text/plain' }));
    expect((await screen.findByRole('alert')).textContent).toContain('20 MB limit');
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.txt' }));
    pick(new File(['x'], 'b.txt', { type: 'text/plain' }));
    await screen.findByText(/Ready/u);
    fireEvent.click(screen.getByRole('button', { name: 'Remove b.txt' }));
    expect(deleteAttachment).toHaveBeenCalledWith(expect.anything(), config, fileId);
    expect(screen.queryByText('b.txt')).toBeNull();
  });

  it('warns when Jarvis could not read an uploaded file', async () => {
    uploadAttachment.mockResolvedValueOnce({ id: fileId, name: 'scan.pdf', contentType: 'application/pdf', size: 3, status: 'failed' });
    renderConversation();
    await screen.findByRole('textbox', { name: 'Message Jarvis' });
    pick(new File(['%PDF-'], 'scan.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText(/Jarvis couldn’t read this file/u)).toBeTruthy();
  });

  it.each([false, true])('keeps the native picker source open through cancel and closes after selection (phone=%s)', async (phone) => {
    renderConversation(phone);
    await screen.findByRole('textbox', { name: 'Message Jarvis' });
    const trigger = screen.getByRole('button', { name: 'More options' });
    fireEvent.click(trigger);
    const action = screen.getByRole('menuitem', { name: 'Attach file or photo' });
    const input = screen.getByTestId('attachment-input');
    const click = vi.spyOn(input, 'click');
    action.focus();
    fireEvent.click(action);
    expect(click).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(action);
    expect(action.parentElement?.contains(input)).toBe(true);
    // Native chooser focus loss has no DOM relatedTarget; it must not dismiss the source.
    fireEvent.blur(action, { relatedTarget: null });
    fireEvent(input, new Event('cancel', { bubbles: true }));
    expect(screen.getByTestId('attachment-input')).toBe(input);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(uploadAttachment).not.toHaveBeenCalled();
    fireEvent.click(action);
    expect(click).toHaveBeenCalledTimes(2);
    fireEvent.change(input, { target: { files: [new File(['photo'], 'photo.png', { type: 'image/png' })] } });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    await screen.findByText('photo.png');
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers the attach action in the More menu', async () => {
    renderConversation();
    await screen.findByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items[0]?.getAttribute('aria-label') ?? items[0]?.textContent).toContain('Attach file or photo');
    expect(items[1]?.textContent).toContain('Language');
  });
});

describe('conversation attachments', () => {
  const attachment = { id: fileId, name: 'bug.png', contentType: 'image/png', size: 2048 };
  const history = (extra: object[] = []) => ({
    messages: [
      { id: '1', sessionId: '41', channel: 'chat', language: 'en', role: 'dan', text: 'See this', model: null, at: '2026-10-03T12:00:00.000Z', toolCalls: [], attachments: [attachment] },
      ...extra,
    ],
    nextCursor: null,
  });

  it('previews sent images from their signed URL and opens one on demand', async () => {
    loadConversationHistory.mockResolvedValue(history());
    loadAttachmentUrl.mockResolvedValue('https://acct.blob.core.windows.net/x?sig=1');
    const tab = { location: { href: '' }, close: vi.fn(), opener: {} };
    vi.spyOn(window, 'open').mockReturnValue(tab as never);
    renderConversation();
    expect(await screen.findByRole('img', { name: 'Preview of bug.png' })).toHaveProperty('src', 'https://acct.blob.core.windows.net/x?sig=1');
    fireEvent.click(await screen.findByRole('button', { name: 'Open bug.png' }));
    await waitFor(() => expect(tab.location.href).toBe('https://acct.blob.core.windows.net/x?sig=1'));
    expect(tab.opener).toBeNull();
  });

  it('replaces a failed sent-image preview with an accessible unavailable state', async () => {
    loadConversationHistory.mockResolvedValue(history());
    loadAttachmentUrl.mockResolvedValue('https://acct.blob.core.windows.net/x?sig=1');
    renderConversation();
    fireEvent.error(await screen.findByRole('img', { name: 'Preview of bug.png' }));
    expect(await screen.findByRole('img', { name: 'Preview unavailable for bug.png' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Preview of bug.png' })).toBeNull();
  });

  it('shows an expired attachment and other open failures', async () => {
    loadConversationHistory.mockResolvedValue(history());
    vi.spyOn(window, 'open').mockReturnValue(null);
    loadAttachmentUrl.mockRejectedValueOnce(new AttachmentExpiredError());
    renderConversation();
    expect((await screen.findByText(/Expired or removed/u))).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Open bug.png' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('falls back to a link when the browser blocks the new tab', async () => {
    loadConversationHistory.mockResolvedValue(history());
    vi.spyOn(window, 'open').mockReturnValue(null);
    loadAttachmentUrl.mockResolvedValue('https://acct.blob.core.windows.net/x?sig=1');
    renderConversation();
    fireEvent.click(await screen.findByRole('button', { name: 'Open bug.png' }));
    const link = await screen.findByRole('link', { name: 'Open bug.png' });
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('previews the image with a public-repository note beside Jarvis’s confirmation question', async () => {
    loadConversationHistory.mockResolvedValue(history([
      { id: '2', sessionId: '41', channel: 'chat', language: 'en', role: 'jarvis', text: 'Say exactly "confirm 12345678 publish bug.png" to publish.', model: null, at: '2026-10-03T12:01:00.000Z', toolCalls: [], attachments: [] },
    ]));
    loadAttachmentUrl.mockResolvedValue('https://acct.blob.core.windows.net/x?sig=1');
    renderConversation();
    expect(await screen.findByText(/This repository is public\./u)).toBeTruthy();
    expect((await screen.findByAltText('Image to publish: bug.png')).getAttribute('src')).toContain('blob.core.windows.net');
  });
});
