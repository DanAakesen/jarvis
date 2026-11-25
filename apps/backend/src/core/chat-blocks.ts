import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  chatBlockInputSchema, chatBlockLimits, isChatBlock, type ChatBlock, type ChatBlockInput, type GeneratedView,
} from '@jarvis/contracts';
import { appleMapsGuidance, generatedViewValidationOptions } from './generated-view-validation.js';
import { ToolFailure, ToolRefusal, type JarvisTool } from './tool-registry.js';

const pendingTtlMs = 15 * 60 * 1000;

declare module 'fastify' {
  interface FastifyInstance {
    chatBlocks: ChatBlockBuffer;
  }
}

/**
 * Blocks a model has produced while a chat turn is running. The turn takes them when it stores the assistant
 * reply, so each block is saved inside the message it belongs to and nowhere else.
 */
export class ChatBlockBuffer {
  private readonly pending = new Map<string, { blocks: ChatBlock[]; at: number }>();

  add(sessionId: string, block: ChatBlock, now = Date.now()): boolean {
    for (const [key, entry] of this.pending) {
      if (now - entry.at > pendingTtlMs) this.pending.delete(key);
    }
    const entry = this.pending.get(sessionId) ?? { blocks: [], at: now };
    if (entry.blocks.length >= chatBlockLimits.blocksPerMessage) return false;
    entry.blocks.push(block);
    entry.at = now;
    this.pending.set(sessionId, entry);
    return true;
  }

  take(sessionId: string): ChatBlock[] {
    const blocks = this.pending.get(sessionId)?.blocks ?? [];
    this.pending.delete(sessionId);
    return blocks;
  }

  discard(sessionId: string): void {
    this.pending.delete(sessionId);
  }
}

/** Stamps the server-owned fields. The issue time is the model's when it gave one, otherwise now. */
export function finalizeChatBlock(input: ChatBlockInput, now = new Date()): ChatBlock {
  return {
    ...input,
    id: randomUUID(),
    source: { ...input.source, issuedAt: input.source.issuedAt ?? now.toISOString() },
  } as ChatBlock;
}

// Detached tool jobs inherit the turn that started them, including when another call has since opened.
export const voiceWindowTurn = new AsyncLocalStorage<{ app: FastifyInstance; turnId: string }>();

export async function archiveVoiceWindow(
  { app, turnId }: { app: FastifyInstance; turnId: string }, viewId: string, view: GeneratedView,
): Promise<void> {
  const snapshot = { ...view };
  delete snapshot.actions;
  const title = view.title.trim().slice(0, 200) || 'Voice window';
  const sourceItemId = 'voice-window:' + createHash('sha256').update(viewId).digest('hex');
  const saved = await app.conversationStore?.saveVoiceWindow?.(app.ownerObjectId, turnId, sourceItemId, {
    version: 1, type: 'voice-window', id: randomUUID(), title, summary: title,
    source: { label: 'Voice', issuedAt: new Date().toISOString() }, data: { view: snapshot },
  });
  if (!saved) throw new ToolFailure('Window displayed. Saving it in Chat could not be confirmed.', { outcomeUnknown: true });
  app.nowEventHub.publish({ type: 'refresh' });
}

const contractRefusal = 'The block does not match the contract: version 1, a type, title, source.label, summary and data for the type. ' +
  'Forecast: place, YYYY-MM-DD date, conditions, symbol, low not above high. Chart: xLabel and 1-4 panels, one unit each, 1-3 named series, null for a missing y. ' +
  'View: text, list, table, detail, timeline, task-card, status or image with open-route or open-link actions only. Nothing was shown.';

export const showInChatTool: JarvisTool = {
  name: 'show_in_chat',
  description: 'Show structured content inside this chat reply, below your text, when a sentence is not the best way to present a result: a forecast, a chart, a list, a table, a timeline or a status. ' +
    'Use it only in typed chat; in a voice conversation show it on the screen with workspace_command instead. Call it in the same turn, then write one short sentence that introduces it and do not repeat its numbers. ' +
    'You choose the type: forecast (one place and date: conditions, high and low in °C), chart (panels, each with one unit and its own scale, for example temperature in °C and rain probability in %, never mixed; use null for a missing value), or view (a generated view with the text, list, table, detail, timeline, task-card, status or image renderer). ' +
    'The block is saved with the reply and never changes later. Use real values from a tool result, never invented ones; say so in source.status partial with a reason when data is incomplete. ' +
    'source.label names where the data came from; source.issuedAt is when it was issued (it defaults to now). summary is the text alternative and must state the key values.',
  inputSchema: chatBlockInputSchema as JarvisTool['inputSchema'],
  execution: { defaultEffect: 'read' },
  sensitive: true,
  explainInvalidInput: appleMapsGuidance,
  async execute(input, request) {
    const guidance = appleMapsGuidance(input);
    if (guidance) throw new ToolRefusal(guidance);
    const app: FastifyInstance = request.server;
    const messageId = request.headers['x-jarvis-message-id'] ?? request.jarvisMemorySourceMessageId;
    const store = app.conversationStore;
    const sessionId = typeof messageId === 'string' ? await store?.getMessageSessionId?.(messageId) : null;
    if (!sessionId) {
      throw new ToolRefusal('There is no chat reply to attach this block to. Answer in text. Nothing was shown.');
    }
    // A block lives inside a typed reply. A spoken turn has none, so a block queued there would never be shown.
    if ((await store?.getSession(sessionId))?.channel !== 'chat') {
      throw new ToolRefusal('Blocks belong to typed chat replies. In a voice conversation show the result on the screen with workspace_command. Nothing was shown.');
    }
    if (!isChatBlock(input, { ...generatedViewValidationOptions(app), stored: false })) {
      throw new ToolRefusal(contractRefusal);
    }
    const block = finalizeChatBlock(input);
    if (!app.chatBlocks.add(sessionId, block)) {
      throw new ToolRefusal(`A reply holds at most ${chatBlockLimits.blocksPerMessage} blocks. Nothing more was shown.`);
    }
    return {
      blockId: block.id,
      confirmation: 'The block will appear under your reply. Write a short sentence that introduces it and do not repeat its values.',
    };
  },
};
