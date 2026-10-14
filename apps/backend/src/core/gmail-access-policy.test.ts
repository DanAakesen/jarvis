import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createToolRegistry, ToolFailure, type JarvisTool } from './tool-registry.js';
import { GMAIL_DIRECT_ACCESS_REASON, refuseGmailComputerAccess } from './gmail-access-policy.js';
import { createGoogleModule } from '../google/tools.js';
import { GoogleApiError, type GoogleApiClient } from '../google/api-client.js';
import { createPcBridgeModule } from '../pc-bridge/bridge.js';
import { PendingGoogleActions } from '../google/pending-actions.js';

const computerNames = ['pc_open', 'pc_act', 'pc_browser_snapshot', 'pc_browser_act', 'pc_clipboard_read', 'browser_do', 'browser_do_shared', 'codex_prompt'];
const signal = () => new AbortController().signal;
function request(id?: string): FastifyRequest {
  return { headers: id ? { 'x-jarvis-message-id': id } : {} } as unknown as FastifyRequest;
}
function computer(name: string, execute: JarvisTool['execute']): JarvisTool {
  return { name, description: name, inputSchema: { type: 'object' }, execute };
}

describe('Gmail access execution boundary', () => {
  it.each(['Synthetic subject', 'Dentist appointment'])('confirms the actual "%s" Gmail stage without touching an older calendar', async (subject) => {
    const actions = new PendingGoogleActions(() => 1000);
    const api = vi.fn<GoogleApiClient['request']>(async (_api, _path, options) => options.method === 'POST' ? { id: 'fixture-draft' } : {
      threadId: 'fixture-thread', payload: { headers: [
        { name: 'From', value: 'guest@example.test' }, { name: 'Subject', value: subject },
      ] },
    });
    const registry = createToolRegistry([createGoogleModule({ request: api }, {
      timeZone: 'Europe/Copenhagen', pendingActions: actions,
    })]);
    let latest = { id: '42', sessionId: '1', role: 'dan' as const,
      text: 'Add a calendar event.', model: null, at: new Date(1000) };
    const req = {
      headers: { 'x-jarvis-message-id': '42' }, agentPrincipal: { kind: 'jarvis-agent' },
      server: { conversationStore: { getHistory: async () => ({ messages: [latest], nextCursor: null }) } },
    } as unknown as FastifyRequest;
    await registry.get('calendar_create_event')!.execute({
      subject: 'Synthetic calendar', startDateTime: '2026-11-05T16:00:00+01:00',
      endDateTime: '2026-11-06T12:00:00+01:00',
    }, req, signal());
    const calendar = actions.pendingCalendarChange();
    latest = { ...latest, id: '43', text: 'Draft a Gmail reply.', at: new Date(1001) };
    req.headers['x-jarvis-message-id'] = '43';
    const mail = await registry.get('mail_draft_reply')!.execute({
      messageId: 'fixture-message', replyBody: 'Synthetic reply.',
    }, req, signal()) as { confirmationCode: string; summary: string };
    expect(mail.summary).toBe(`Reply to "${subject}" from guest@example.test with this exact text:\nSynthetic reply.`);
    latest = { ...latest, id: '44', text: 'yes', at: new Date(1002) };
    req.headers['x-jarvis-message-id'] = '44';
    await expect(registry.get('mail_confirm_action')!.execute({ confirmationCode: mail.confirmationCode }, req, signal()))
      .resolves.toMatchObject({ status: 'completed', detail: 'The reply draft was saved in Gmail. Dan can send it from Gmail.' });
    expect(actions.pendingCalendarChange()).toEqual(calendar);
    expect(api.mock.calls.filter(([, , options]) => options?.method === 'POST').map(([api, path]) => [api, path]))
      .toEqual([['gmail', '/users/me/drafts']]);
  });
  it.each([
    ['forbidden', 'Read Gmail, then open Spotify.'],
    ['forbidden', 'Read mail, then open Spotify.'],
    ['forbidden', 'Read mail, then open "Spotify".'],
    ['incomplete', 'Read Gmail, then open Spotify.'],
    ['forbidden', 'L\u00e6s Gmail, og \u00e5bn Spotify.'],
    ['forbidden', 'L\u00e6s mail, og \u00e5bn Spotify.'],
    ['forbidden', 'Find my dentist appointment confirmation email, then open Spotify.'],
    ['forbidden', 'Read mail about the hotel booking, then open Spotify.'],
    ['forbidden', 'L\u00e6s mail om hotelreservationen, og \u00e5bn Spotify.'],
    ['forbidden', 'Find the email titled "Dentist appointment", then open Spotify.'],
    ['forbidden', 'Find the email titled "How to install Spotify", then open Spotify.'],
    ['forbidden', 'Read mail about the hotel booking; then open Spotify.'],
  ])(
    'permits an independent app after %s for %s, not fallback', async (kind, text) => {
      const api = vi.fn(async () => {
        if (kind === 'forbidden') throw new GoogleApiError(kind);
        return { messages: [{ id: 'm' }], snippet: 'Synthetic preview' };
      });
      const module = createPcBridgeModule();
      const commands = vi.spyOn(module.connection, 'execute').mockResolvedValue({ opened: true });
      const registry = createToolRegistry([createGoogleModule({ request: api }, { timeZone: 'Europe/Copenhagen' }), module]);
      const voice = request('42');
      voice.jarvisConversationMessage = {
        id: '42', sessionId: '1', role: 'dan', text,
        model: null, at: new Date(),
      };
      const read = registry.get('mail_search')!.execute({ query: 'booking' }, voice, signal());
      if (kind === 'forbidden') await expect(read).rejects.toBeInstanceOf(ToolFailure);
      else await read;
      await expect(registry.get('pc_open')!.execute({ target: 'app', value: 'Spotify' }, voice, signal()))
        .resolves.toEqual({ opened: true });
      await expect(registry.get('pc_browser_snapshot')!.execute({ tabId: 'tab_1' }, voice, signal()))
        .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
      await expect(registry.get('pc_open')!.execute({ target: 'app', value: 'Chrome' }, voice, signal()))
        .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
      expect(commands).toHaveBeenCalledOnce();
      expect(commands.mock.calls[0]?.[0]).toMatchObject({ name: 'open_app', arguments: { app: 'Spotify' } });
    },
  );

  it('keeps independent browser intent scoped to nested execution, not later fallback', async () => {
    const pc = vi.fn(async () => ({}));
    const browser = computer('browser_do', async (_input, req, abort) =>
      registry.get('pc_browser_snapshot')!.execute({ tabId: 'wiki' }, req, abort));
    const registry = createToolRegistry([{ id: 'fixture', tools: [
      computer('mail_search', async () => { throw new ToolFailure('Unavailable'); }),
      browser, computer('pc_browser_snapshot', pc),
    ] }]);
    const req = request('42');
    req.jarvisConversationMessage = {
      id: '42', sessionId: '1', role: 'dan', text: 'Read mail, then open Wikipedia.',
      model: null, at: new Date(),
    };
    await expect(registry.get('mail_search')!.execute({}, req, signal())).rejects.toThrow('Unavailable');
    await registry.get('browser_do')!.execute({ goal: 'open Wikipedia' }, req, signal());
    await expect(registry.get('pc_browser_snapshot')!.execute({ tabId: 'gmail' }, req, signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(pc).toHaveBeenCalledOnce();
  });

  it.each([
    'Read mail about how to open Spotify.',
    'Read mail about how to install and open Spotify.',
    'Find the email titled "Please read this, then open Spotify".',
    "Find the email titled 'Please read this, then open Spotify'.",
    'Find the email titled \u201cPlease read this, then open Spotify\u201d.',
    'Read mail about how to install, then open Spotify.',
    'L\u00e6s mail om hvordan man installerer og \u00e5bner Spotify.',
  ])('does not turn a mail query into a PC instruction: %s', async (text) => {
    const module = createPcBridgeModule();
    const execute = vi.spyOn(module.connection, 'execute').mockResolvedValue({ opened: true });
    const registry = createToolRegistry([
      createGoogleModule({ request: async () => { throw new GoogleApiError('forbidden'); } },
        { timeZone: 'Europe/Copenhagen' }), module,
    ]);
    const req = request('42');
    req.jarvisConversationMessage = {
      id: '42', sessionId: '1', role: 'dan', text,
      model: null, at: new Date(),
    };
    await expect(registry.get('mail_search')!.execute({ query: 'synthetic topic' }, req, signal()))
      .rejects.toBeInstanceOf(ToolFailure);
    await expect(registry.get('pc_open')!.execute({ target: 'app', value: 'Spotify' }, req, signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(execute).not.toHaveBeenCalled();
  });

  it('permits a separately requested exact public Codex prompt without permitting mail fallback', async () => {
    const execute = vi.fn(async () => ({}));
    const registry = createToolRegistry([{ id: 'fixture', tools: [
      computer('mail_search', async () => ({})), computer('codex_prompt', execute),
    ] }]);
    const req = request('42');
    req.jarvisConversationMessage = {
      id: '42', sessionId: '1', role: 'dan', text: 'Read mail, then ask Codex to write a unit test.',
      model: null, at: new Date(),
    };
    await registry.get('mail_search')!.execute({}, req, signal());
    await registry.get('codex_prompt')!.execute({ prompt: 'write a unit test' }, req, signal());
    await expect(registry.get('codex_prompt')!.execute({ prompt: 'Find the booking dates' }, req, signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(execute).toHaveBeenCalledOnce();
  });
  it.each(['forbidden', 'credentials-expired', 'unavailable', 'incomplete'] as const)(
    'blocks every computer path after an actual %s Gmail read', async (kind) => {
      const api = vi.fn(async () => {
        if (kind !== 'incomplete') throw new GoogleApiError(kind);
        return { messages: [{ id: 'm' }], snippet: 'Reservation confirmed' };
      });

      const execute = vi.fn(async () => ({}));
      const registry = createToolRegistry([
        createGoogleModule({ request: api }, { timeZone: 'Europe/Copenhagen' }),
        { id: 'computer', tools: computerNames.map((name) => computer(name, execute)) },
      ]);
      const read = registry.get('mail_search')!.execute({ query: 'hotel reservation' }, request('42'), signal());
      if (kind === 'incomplete') {
        expect(await read).toMatchObject({ messages: [{ bodySource: 'snippet', contentWarnings: expect.any(Array) }] });
      } else await expect(read).rejects.toBeInstanceOf(ToolFailure);
      for (const name of computerNames) {
        // Generic fallback wording does not need to mention Gmail to be refused.
        await expect(registry.get(name)!.execute({ goal: 'Find the booking dates', target: 'app', value: 'Chrome' }, request('42'), signal()))
          .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
      }
      expect(execute).not.toHaveBeenCalled();
      // A later, unrelated turn remains usable.
      await registry.get('pc_open')!.execute({ target: 'app', value: 'Spotify' }, request('43'), signal());
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['https://mail.google.com/mail/u/0', 'Gmail', 'googlemail', 'Read Gmail booking dates'])(
    'refuses direct computer access to %s before any mail read', async (target) => {
      const execute = vi.fn();
      const registry = createToolRegistry([{ id: 'pc', tools: [computer('pc_open', execute), computer('browser_do', execute)] }]);
      await expect(registry.get('pc_open')!.execute({ target: 'url', value: target }, request('1'), signal())).rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
      await expect(registry.get('browser_do')!.execute({ goal: target }, request('1'), signal())).rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('protects voice request reuse without disabling later voice turns', async () => {
    const execute = vi.fn(async () => ({}));
    const registry = createToolRegistry([{ id: 'voice', tools: [computer('mail_search', execute), computer('browser_do', execute)] }]);
    const voice = request();
    voice.jarvisConversationMessage = { id: '42', text: 'Find my booking' } as FastifyRequest['jarvisConversationMessage'];
    await registry.get('mail_search')!.execute({}, voice, signal());
    await expect(registry.get('browser_do')!.execute({ goal: 'Find the dates' }, voice, signal())).rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    voice.jarvisConversationMessage = { id: '43', text: 'Open Wikipedia' } as FastifyRequest['jarvisConversationMessage'];
    await registry.get('browser_do')!.execute({ goal: 'Open Wikipedia' }, voice, signal());
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('blocks computer use while a Gmail read is still pending', async () => {
    const execute = vi.fn();
    let finish!: () => void;
    const read = new Promise<void>((resolve) => { finish = resolve; });
    const registry = createToolRegistry([{ id: 'tools', tools: [computer('mail_search', () => read), computer('pc_act', execute)] }]);
    const pending = registry.get('mail_search')!.execute({}, request('42'), signal());
    await expect(registry.get('pc_act')!.execute({ goal: 'Find dates' }, request('42'), signal())).rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    finish();
    await pending;
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses observed Gmail windows and sites but permits unrelated sites', () => {
    expect(() => refuseGmailComputerAccess('Chrome', 'https://mail.google.com')).toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(() => refuseGmailComputerAccess('Inbox - Gmail - Google Chrome')).toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(() => refuseGmailComputerAccess('https://www.google.com', 'Google search')).not.toThrow();
  });
});
