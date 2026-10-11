import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';
import {
  MAX_ATTACHMENTS,
  UNSENT_UPLOAD_LIFETIME_MS,
  deleteAttachment,
  namePastedFile,
  uploadAttachment,
  validateAttachmentFile,
  type ChatAttachment,
} from './chat-attachments';

export interface PendingAttachment {
  key: number;
  name: string;
  contentType: string;
  size: number;
  status: 'uploading' | 'ready' | 'failed';
  /** 0–1 while uploading. */
  progress: number;
  /** Set once the upload finished. */
  id?: string;
  uploadedAt?: number;
  /** Jarvis could not extract text or a description from the file. */
  unreadable?: boolean;
  error?: string;
  /** Local object URL for an image thumbnail. */
  previewUrl?: string;
}

function createPreview(file: File): string | undefined {
  if (!file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') return undefined;
  return URL.createObjectURL(file);
}

function revoke(item: PendingAttachment) {
  if (item.previewUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(item.previewUrl);
}

/** Pending files in the composer: validated, uploaded privately one request each, removable until sent. */
export function useChatAttachments(client: PublicClientApplication, config: PublicConfig) {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const itemsRef = useRef<PendingAttachment[]>([]);
  const controllers = useRef(new Map<number, AbortController>());
  const nextKey = useRef(0);

  const commit = useCallback((update: (current: PendingAttachment[]) => PendingAttachment[]) => {
    itemsRef.current = update(itemsRef.current);
    setItems(itemsRef.current);
  }, []);
  const patch = useCallback((key: number, change: Partial<PendingAttachment>) => {
    commit((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));
  }, [commit]);

  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active.values()) controller.abort();
      active.clear();
    };
  }, []);

  const add = useCallback((files: readonly File[]) => {
    const messages: string[] = [];
    let counted = itemsRef.current.filter((item) => item.status !== 'failed').length;
    for (const original of files) {
      const named = namePastedFile(original);
      const checked = validateAttachmentFile(named);
      if ('error' in checked) { messages.push(checked.error); continue; }
      if (counted >= MAX_ATTACHMENTS) {
        messages.push(`Only ${MAX_ATTACHMENTS} files fit in one message; ${named.name} was not added.`);
        continue;
      }
      counted += 1;
      const file = checked.file;
      const key = ++nextKey.current;
      const previewUrl = createPreview(file);
      const controller = new AbortController();
      controllers.current.set(key, controller);
      commit((current) => [...current, {
        key, name: file.name, contentType: file.type, size: file.size, status: 'uploading', progress: 0,
        ...(previewUrl ? { previewUrl } : {}),
      }]);
      void uploadAttachment(client, config, file, {
        signal: controller.signal,
        onProgress: (progress) => patch(key, { progress }),
      }).then((uploaded) => {
        patch(key, {
          status: 'ready', progress: 1, id: uploaded.id, name: uploaded.name, contentType: uploaded.contentType,
          size: uploaded.size, uploadedAt: Date.now(), ...(uploaded.status === 'failed' ? { unreadable: true } : {}),
        });
      }).catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        patch(key, { status: 'failed', error: reason instanceof Error ? reason.message : 'The upload failed.' });
      }).finally(() => {
        controllers.current.delete(key);
      });
    }
    setProblems(messages);
  }, [client, commit, config, patch]);

  const remove = useCallback((key: number) => {
    const item = itemsRef.current.find((candidate) => candidate.key === key);
    if (!item) return;
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    revoke(item);
    commit((current) => current.filter((candidate) => candidate.key !== key));
    setProblems([]);
    if (item.id) void deleteAttachment(client, config, item.id).catch(() => {});
  }, [client, commit, config]);

  /** Deletes private uploads that will not be sent (best effort; unsent files also expire after 24 hours). */
  const discard = useCallback((ids: readonly string[]) => {
    for (const id of ids) void deleteAttachment(client, config, id).catch(() => {});
  }, [client, config]);

  /** Moves the ready uploads out of the composer for sending. Failed uploads are dropped. */
  const take = useCallback((): ChatAttachment[] => {
    const now = Date.now();
    const uploaded = itemsRef.current.filter((item) => item.status === 'ready' && item.id);
    const ready = uploaded.filter((item) => now - (item.uploadedAt ?? now) < UNSENT_UPLOAD_LIFETIME_MS);
    const expired = uploaded.filter((item) => !ready.includes(item));
    for (const item of itemsRef.current) revoke(item);
    commit(() => []);
    setProblems(expired.length ? [`${expired.map((item) => item.name).join(', ')} expired before sending and was not attached. Attach it again.`] : []);
    return ready.map((item) => ({ id: item.id!, name: item.name, contentType: item.contentType, size: item.size }));
  }, [commit]);

  /** Puts attachments of a message that was not saved back into the composer. */
  const restore = useCallback((attachments: readonly ChatAttachment[]) => {
    commit((current) => [
      ...attachments
        .filter((attachment) => !current.some((item) => item.id === attachment.id))
        .map((attachment): PendingAttachment => ({
          key: ++nextKey.current, name: attachment.name, contentType: attachment.contentType, size: attachment.size,
          status: 'ready', progress: 1, id: attachment.id, uploadedAt: Date.now(),
        })),
      ...current,
    ].slice(0, MAX_ATTACHMENTS + current.filter((item) => item.status === 'failed').length));
  }, [commit]);

  const uploading = items.some((item) => item.status === 'uploading');
  const ready = items.filter((item) => item.status === 'ready').length;
  const counted = items.filter((item) => item.status !== 'failed').length;

  return { items, problems, uploading, ready, full: counted >= MAX_ATTACHMENTS, add, remove, discard, take, restore };
}
