import { describe, expect, it, vi } from 'vitest';
import { createFoundryScreenVisionModel } from './foundry-model.js';

describe('Foundry screen vision model', () => {
  it('requests strict watch JSON with untrusted observations, source context, and the dedicated vision settings', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request).toMatchObject({
        model: 'gpt-6-luna', max_completion_tokens: 500, reasoning_effort: 'none',
        response_format: { type: 'json_object' },
      });
      expect(request.messages[0].role).toBe('system');
      expect(request.messages[0].content).toContain('untrusted');
      expect(request.messages[0].content).toContain('Stay silent');
      expect(JSON.parse(request.messages[1].content[0].text)).toMatchObject({
        source: 'camera', previousSummary: 'Sitting upright.', instructions: ['Tell me if my posture slips'],
        latestQuestion: null, recentComments: [],
      });
      expect(request.messages[1].content[1].image_url.detail).toBe('auto');
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"summary":"Sitting upright.","noteworthy":false,"speak":null}' } }],
        usage: { prompt_tokens: 1136, completion_tokens: 26 },
      }));
    });
    const model = createFoundryScreenVisionModel('https://test.services.ai.azure.com/api/projects/jarvis', async () => 'identity-token', fetcher);
    await model.describe({
      image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), model: 'gpt-6-luna', signal: new AbortController().signal,
      watch: { source: 'camera', previousSummary: 'Sitting upright.', instructions: ['Tell me if my posture slips'],
        latestQuestion: null, recentComments: [] },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('uses the managed-identity token and returns bounded description and token usage', async () => {
    const getToken = vi.fn(async (scope: string) => {
      expect(scope).toBe('https://ai.azure.com/.default');
      return 'managed-identity-token';
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new URL(String(input)).pathname).toBe('/models/chat/completions');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        ['Bearer', 'managed-identity-token'].join(' '),
      );
      const request = JSON.parse(String(init?.body)) as {
        model: string;
        max_tokens?: number;
        max_completion_tokens?: number;
        reasoning_effort?: string;
        messages: { content: { type: string; image_url?: { url: string; detail?: string } }[] }[];
      };
      expect(request.model).toBe('gpt-6-luna');
      expect(request.max_tokens).toBeUndefined();
      expect(request.max_completion_tokens).toBe(500);
      expect(request.reasoning_effort).toBe('none');
      expect(request.messages[0]?.content[1]?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/u);
      expect(request.messages[0]?.content[1]?.image_url?.detail).toBe('auto');
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'A browser window with a chart.' } }],
        usage: { prompt_tokens: 1136, completion_tokens: 26 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const model = createFoundryScreenVisionModel(
      'https://test.services.ai.azure.com/api/projects/jarvis',
      getToken,
      fetcher,
    );

    await expect(model.describe({
      image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      model: 'gpt-6-luna',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      description: 'A browser window with a chart.',
      inputTokens: 1136,
      outputTokens: 26,
      costDkk: 0.00083289,
      costUsd: 0.00012661,
    });
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('requests structured transient visual targets with normalized boxes', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        model: string;
        response_format: { type: string };
        messages: { content: { type: string; text?: string; image_url?: { url: string } }[] }[];
      };
      expect(request.model).toBe('gpt-5.6-luna');
      expect(request.response_format).toEqual({ type: 'json_object' });
      expect(request.messages[0]?.content[0]?.text).toContain('normalized x, y, width, height');
      expect(request.messages[0]?.content[1]?.image_url?.url).toMatch(/^data:image\/png;base64,/u);
      return new Response(JSON.stringify({
        choices: [{
          message: { content: JSON.stringify({
            elements: [{ label: 'Start', role: 'button', box: { x: 0.25, y: 0.3, width: 0.5, height: 0.2 } }],
          }) },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const model = createFoundryScreenVisionModel(
      'https://test.services.ai.azure.com/api/projects/jarvis',
      async () => 'managed-identity-token',
      fetcher,
    );

    await expect(model.locateElements({
      image: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      model: 'gpt-5.6-luna',
      signal: new AbortController().signal,
    })).resolves.toEqual([{
      index: 0,
      role: 'button',
      name: 'Start',
      bounds: { x: 0.25, y: 0.3, width: 0.5, height: 0.2 },
    }]);
  });

  it('rejects visual boxes that extend outside the captured image', async () => {
    const model = createFoundryScreenVisionModel(
      'https://test.services.ai.azure.com/api/projects/jarvis',
      async () => 'managed-identity-token',
      async () => new Response(JSON.stringify({
        choices: [{
          message: { content: '{"elements":[{"label":"Start","role":"button","box":{"x":0.9,"y":0.2,"width":0.2,"height":0.2}}]}' },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    await expect(model.locateElements({
      image: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      model: 'gpt-5.6-luna',
      signal: new AbortController().signal,
    })).rejects.toThrow('Invalid screen model response');
  });
});
