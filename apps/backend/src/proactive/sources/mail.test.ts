import { describe, expect, it, vi } from 'vitest';
import { createGoogleApiClient } from '../../google/api-client.js';
import { defaultProactiveSettings } from '../store.js';
import { createMailSource } from './mail.js';

function fixture() {
  const state = { token: 'first', ids: ['one', 'newsletter'], failList: false, failMessage: '', switchAfterList: false };
  const calls: string[] = [];
  const getToken = vi.fn(async () => state.token);
  const google = createGoogleApiClient({ tokens: { getToken }, fetch: async (input, options) => {
    const url = new URL(String(input));
    const account = new Headers(options?.headers).get('Authorization')!.slice('Bearer '.length);
    const id = url.pathname.split('/').at(-1)!;
    calls.push(`${account}/${id}`);
    if (id === 'messages') {
      expect(url.searchParams.get('q')).toBe('in:inbox is:unread category:primary newer_than:2d');
      if (state.switchAfterList) { state.token = 'second'; state.switchAfterList = false; }
      if (state.failList) return new Response(null, { status: 401 });
      return Response.json({ messages: state.ids.map(id => ({ id })) });
    }
    if (state.failMessage === id) return new Response(null, { status: 503 });
    return Response.json({ id, payload: { headers: [
      { name: 'From', value: 'Alice <alice@example.invalid>' },
      { name: 'Subject', value: `${account} ${id}` },
      { name: 'Date', value: 'Mon, 23 Nov 2026 08:00:00 GMT' },
      ...(id === 'newsletter' ? [{ name: 'List-Unsubscribe', value: '<https://example.invalid/unsubscribe>' }] : []),
    ] } });
  } });
  const source = createMailSource(google);
  return { state, calls, getToken, poll: () => source.read({
    now: new Date('2026-11-23T08:15:00Z'), signal: new AbortController().signal, settings: defaultProactiveSettings(),
  }) };
}

describe('proactive Gmail refresh', () => {
  it('refreshes membership and fetches only new IDs, including after an ID leaves and returns', async () => {
    const { state, calls, poll } = fixture();
    state.ids = ['newsletter', ...Array.from({ length: 14 }, (_, i) => String(i))];
    const first = await poll();
    expect(first.facts).toHaveLength(14);
    expect(calls.splice(0)).toHaveLength(16);
    expect(await poll()).toEqual(first);
    expect(calls.splice(0)).toEqual(['first/messages']);
    state.ids = ['new', ...state.ids.slice(1)];
    expect((await poll()).facts).toHaveLength(15);
    expect(calls.splice(0)).toEqual(['first/messages', 'first/new']);
    state.ids = ['newsletter'];
    expect((await poll()).facts).toEqual([]);
    expect(calls).toEqual(['first/messages', 'first/newsletter']);
  });

  it('retries failed metadata, discards cached facts after disconnect, and pins a poll to one account', async () => {
    const { state, calls, getToken, poll } = fixture();
    state.ids = ['one', 'two'];
    state.failMessage = 'two';
    expect((await poll()).facts).toHaveLength(1);
    calls.length = 0;
    state.failMessage = '';
    expect((await poll()).facts).toHaveLength(2);
    expect(calls.splice(0)).toEqual(['first/messages', 'first/two']);
    state.failList = true;
    expect(await poll()).toMatchObject({ state: 'unavailable', facts: [] });
    state.failList = false;
    state.switchAfterList = true;
    calls.length = 0;
    expect((await poll()).facts[0]?.text).toContain('first one');
    expect(calls.splice(0)).toEqual(['first/messages', 'first/one', 'first/two']);
    expect((await poll()).facts[0]?.text).toContain('second one');
    expect(calls).toEqual(['second/messages', 'second/one', 'second/two']);
    expect(getToken).toHaveBeenCalledTimes(5);
  });
});
