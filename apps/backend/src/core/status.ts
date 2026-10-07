import type { FastifyRequest } from 'fastify';
import type { NowFeedSnapshot } from './now.js';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';

const inputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

function countPhrase(count: number, singular: string, plural: string): string {
  const amount = count >= 100 ? '100 or more' : String(count);
  return `${amount} ${count === 1 ? singular : plural}`;
}

export function summarizeNowFeed(feed: NowFeedSnapshot): string {
  const visible = feed;
  const counts = [
    countPhrase(visible.running.length, 'running task', 'running tasks'),
    countPhrase(visible.items.filter((item) => item.category === 'attention').length, 'task needing attention', 'tasks needing attention'),
    countPhrase(visible.items.filter((item) => item.category === 'release').length, 'release or deployment update', 'release or deployment updates'),
    countPhrase(visible.items.filter((item) => item.category === 'credential').length, 'credential warning', 'credential warnings'),
    countPhrase(visible.items.filter((item) => item.category === 'alert').length, 'alert', 'alerts'),
  ];
  return `The Now feed shows ${counts.join(', ')}.`;
}

function validInput(input: unknown): boolean {
  return input !== null && typeof input === 'object' && !Array.isArray(input) &&
    Object.keys(input).length === 0;
}

export const getStatusSummaryTool: JarvisTool = {
  name: 'get_status_summary',
  description: 'Get a concise summary of current task and activity counts from the Now feed.',
  inputSchema,
  reflexSafe: true,
  execute: async (input: unknown, request: FastifyRequest) => {
    if (!validInput(input)) throw new ToolRefusal('Status request is invalid.');
    if (!request.principal && !request.agentPrincipal) {
      throw new ToolRefusal('Status is unavailable without an authenticated Jarvis identity.');
    }
    const store = request.server.nowFeedStore;
    if (!store) throw new ToolRefusal('The Now feed is unavailable.');
    return { summary: summarizeNowFeed(await store.read()) };
  },
};
