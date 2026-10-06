import { describe, expect, it, vi } from 'vitest';
import { createFoundryScreenVisionModel } from './foundry-model.js';

describe('Foundry screen vision model', () => {
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
        messages: { content: { type: string; image_url?: { url: string } }[] }[];
      };
      expect(request.model).toBe('gpt-5.6-luna');
      expect(request.messages[0]?.content[1]?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/u);
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'A browser window with a chart.' } }],
        usage: { prompt_tokens: 100, completion_tokens: 8 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const model = createFoundryScreenVisionModel(
      'https://test.services.ai.azure.com/api/projects/jarvis',
      getToken,
      fetcher,
    );

    await expect(model.describe({
      image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      model: 'gpt-5.6-luna',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      description: 'A browser window with a chart.',
      inputTokens: 100,
      outputTokens: 8,
      costDkk: 0.0002,
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
