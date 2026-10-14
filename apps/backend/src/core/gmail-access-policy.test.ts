import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createToolRegistry, ToolFailure, type JarvisTool } from './tool-registry.js';
import { GMAIL_DIRECT_ACCESS_REASON, refuseGmailComputerAccess } from './gmail-access-policy.js';
import { createGoogleModule } from '../google/tools.js';
import { GoogleApiError } from '../google/api-client.js';

const computerNames = ['pc_open', 'pc_act', 'pc_browser_snapshot', 'pc_browser_act', 'pc_clipboard_read', 'browser_do', 'browser_do_shared', 'codex_prompt'];
const signal = () => new AbortController().signal;
function request(id?: string): FastifyRequest {
  return { headers: id ? { 'x-jarvis-message-id': id } : {} } as unknown as FastifyRequest;
}
function computer(name: string, execute: JarvisTool['execute']): JarvisTool {
  return { name, description: name, inputSchema: { type: 'object' }, execute };
}

describe('Gmail access execution boundary', () => {
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
