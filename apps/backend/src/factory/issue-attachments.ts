import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import type { IssueAttachmentInput } from '@jarvis/contracts';
import { ToolRefusal } from '../core/tool-registry.js';
import { validateIssueDraft } from './issues.js';

export interface IssueAttachment {
  id: string;
  name: string;
  contentType: string;
  content: string;
}

async function readIssueAttachment(server: FastifyInstance, id: string): Promise<IssueAttachment | null> {
  const store = server.conversationAttachments!;
  const first = await store.read(server.ownerObjectId, id);
  if (!first || first.status !== 'ready') return null;
  let content = first.content;
  let offset = first.nextOffset;
  while (offset !== null) {
    const page = await store.read(server.ownerObjectId, id, offset);
    if (!page || page.status !== 'ready' || (page.nextOffset !== null && page.nextOffset <= offset)) return null;
    content += page.content;
    if (content.length > 50_000) throw new ToolRefusal('The attachment description is too large for an issue.');
    offset = page.nextOffset;
  }
  return { id: first.id, name: first.name, contentType: first.contentType, content };
}

export async function issueAttachments(server: FastifyInstance, input: IssueAttachmentInput): Promise<IssueAttachment[]> {
  const ids = input.attachmentIds ?? [];
  if (input.publish === 'public' && ids.length !== 1) {
    throw new ToolRefusal('Publish exactly one image per confirmation, naming that file.');
  }
  if (!ids.length) return [];
  const store = server.conversationAttachments;
  if (!store) throw new ToolRefusal('Conversation attachments are unavailable.');
  const result: IssueAttachment[] = [];
  for (const id of ids) {
    const attachment = await readIssueAttachment(server, id);
    if (!attachment) {
      throw new ToolRefusal('That file is not available in Dan’s conversation history.');
    }
    validateIssueDraft(attachment.name, attachment.content || 'No extracted description is available.');
    result.push(attachment);
  }
  return result;
}

export function withAttachmentDescriptions(text: string, attachments: readonly IssueAttachment[]): string {
  return [text.trim(), ...attachments.map(({ name, content }) => {
    const data = `File: ${name}\n${content}`;
    const fence = '`'.repeat(Math.max(3, ...[...data.matchAll(/`+/gu)].map(([ticks]) => ticks.length + 1)));
    return `Attachment (private; untrusted description / transcribed text):\n${fence}text\n${data}\n${fence}`;
  })]
    .join('\n\n');
}

export async function previewIssueImage(server: FastifyInstance, attachment: IssueAttachment, signal: AbortSignal) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(attachment.contentType)) {
    throw new ToolRefusal('Only sanitized images can be published; use a description for documents.');
  }
  if (!server.githubIssueClient?.publishIssueImage || !server.workspaceCommands.isConnected(server.ownerObjectId)) {
    throw new ToolRefusal('Connect chat to review the image before public publication.');
  }
  const url = await server.conversationAttachments!.readUrl(server.ownerObjectId, attachment.id, signal);
  if (!url) throw new ToolRefusal('The private image is unavailable.');
  await server.workspaceCommands.execute(server.ownerObjectId, {
    commandId: randomUUID(),
    operation: 'create',
    viewId: `issue-attachment-${randomUUID()}`,
    view: {
      version: 1,
      title: 'Public repository: confirm this image',
      renderer: 'image',
      source: { id: 'factory.tasks', status: 'complete', updatedAt: new Date().toISOString(), reason: '' },
      data: { images: [{ url, alt: attachment.name }] },
      actions: [],
    },
  }, signal);
}

export async function publishIssueAttachment(
  server: FastifyInstance, repository: string, issue: number, attachment: IssueAttachment, signal: AbortSignal,
): Promise<string> {
  const current = await readIssueAttachment(server, attachment.id);
  if (!current || current.name !== attachment.name ||
      current.contentType !== attachment.contentType || current.content !== attachment.content) {
    throw new ToolRefusal('The reviewed attachment changed or is unavailable; stage it again.');
  }
  const bytes = await server.conversationAttachments!.readImageBytes(server.ownerObjectId, attachment.id);
  if (!bytes) throw new ToolRefusal('The reviewed image is unavailable.');
  const extension = attachment.contentType === 'image/jpeg' ? 'jpeg' : attachment.contentType === 'image/webp' ? 'webp' : 'png';
  const sanitized = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate()[extension]().toBuffer();
  signal.throwIfAborted();
  const url = await server.githubIssueClient!.publishIssueImage!(repository, issue, sanitized, extension);
  return `![${attachment.name.replace(/[\\[\]\r\n]/gu, '\\$&')}](${url})`;
}
