import { describe, expect, it } from 'vitest';
import { ToolFailure, ToolRefusal } from '../../../core/tool-registry.js';
import type { ConformanceContext } from '../types.testkit.js';
import { googleGroup } from './google.testkit.js';

/**
 * What the Google tools answer while Google is down, in each way it can be down (the fake in google-fake.testkit.ts fails the way
 * Google does for these tokens). Every advertised tool must end in a typed, plain-English failure, never in an unhandled error that
 * Dan would only see as "Tool execution failed". The one tool that answers differently, by design, is the calendar batch: it reports
 * what it did per event (0 of N created) instead of throwing.
 */
const wake = { agentPrincipal: { objectId: 'conformance-pi' }, jarvisPi: 'wake', headers: { 'x-jarvis-brain': 'google-down' }, log: { error() {} } } as never;

const variants: readonly { readonly title: string; readonly token: string; readonly warm: boolean }[] = [
  { title: 'the network is down before any token was fetched', token: 'google', warm: false },
  { title: 'the network is down after a token was cached', token: 'google', warm: true },
  { title: 'Google answers 503', token: 'google:503', warm: true },
  { title: 'Google answers 429', token: 'google:429', warm: true },
  { title: 'Google answers 403', token: 'google:403', warm: true },
  { title: 'Google answers 401', token: 'google:401', warm: true },
  { title: 'the refresh token was revoked', token: 'google:invalid-grant', warm: false },
  { title: 'Google answers an HTML page instead of JSON', token: 'google:garbage', warm: true },
];

describe('the google tools with Google down', () => {
  it.each(variants.map((variant) => [variant.title, variant] as const))('%s', async (_title, variant) => {
    const down = new Set<string>();
    const group = googleGroup({ down } as unknown as ConformanceContext);
    const tools = new Map(group.modules.flatMap((module) => module.tools).map((tool) => [tool.name, tool]));
    const names = Object.keys(group.cases ?? {});
    expect(names).toHaveLength(17);
    const run = (name: string) => tools.get(name)!.execute(group.cases![name]![0]!.arguments, wake, new AbortController().signal);
    if (variant.warm) await run('calendar_today_agenda');
    down.add(variant.token);

    for (const name of names) {
      const outcome = await run(name).then((result) => ({ result }), (error: unknown) => ({ error }));
      if ('error' in outcome) {
        expect(outcome.error instanceof ToolFailure || outcome.error instanceof ToolRefusal, `${name} threw an untyped error: ${String(outcome.error)}`).toBe(true);
        const message = (outcome.error as Error).message;
        expect(message, `${name}: the message is a plain English sentence about Google`).toMatch(/^(?=[^]*\bGoogle\b)[A-Z][^]*\.$/u);
        expect(message, `${name}: the message leaks an internal error`).not.toMatch(/fetch failed|TypeError|undefined|ECONN|ENOTFOUND/u);
      } else {
        expect(name, `${name} answered ok while Google was down`).toBe('calendar_create_events');
        expect(outcome.result).toMatchObject({ status: 'partial', detail: expect.stringContaining('0 of 2 calendar events were created.') });
      }
    }
  });
});
