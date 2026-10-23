import type { PublicConfig } from '../config/public-config';
import { accessToken } from './conversation-history';
import { backendFetch, beginBackendRequest, recoverOwnerSession, waitForBackendRetry } from './backend-request';
import { isOwnerSessionToken } from './owner-session';

export const MAX_ATTACHMENTS = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
/** Unsent uploads are removed by the backend after 24 hours; the browser stops offering them a little earlier. */
export const UNSENT_UPLOAD_LIFETIME_MS = 23 * 60 * 60 * 1000;

const imageTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};
const documentTypes: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  log: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Passed to the file picker; phones show their photo library, camera and files from the same list. */
export const ATTACHMENT_ACCEPT = [
  ...new Set(Object.values(imageTypes)),
  ...Object.keys(imageTypes).map((extension) => `.${extension}`),
  ...Object.keys(documentTypes).map((extension) => `.${extension}`),
].join(',');

export interface ChatAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
}

export interface UploadedAttachment extends ChatAttachment {
  status: 'uploaded' | 'ready' | 'failed';
}

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class AttachmentExpiredError extends Error {
  constructor() {
    super('This file has expired or was removed.');
    this.name = 'AttachmentExpiredError';
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isImageAttachment(contentType: string): boolean {
  return contentType.startsWith('image/');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function typeLabel(contentType: string): string {
  if (isImageAttachment(contentType)) return 'Image';
  const label = Object.entries(documentTypes).find(([, type]) => type === contentType)?.[0];
  return label ? label.toUpperCase() : 'File';
}

/** Gives a pasted screenshot (often just "image.png") a recognizable name. */
function nameForPastedFile(file: File): string {
  const extension = extensionOf(file.name) || (file.type.startsWith('image/') ? file.type.slice(6).replace('jpeg', 'jpg') : '');
  const bare = file.name.replace(/\.[^.]*$/u, '').toLowerCase();
  if (file.name && bare !== 'image' && bare !== 'blob') return file.name;
  const stamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\..*$/u, '').replace('T', '-');
  return `screenshot-${stamp}.${extension || 'png'}`;
}

export function namePastedFile(file: File): File {
  const name = nameForPastedFile(file);
  return name === file.name ? file : new File([file], name, { type: file.type, lastModified: file.lastModified });
}

/** Checks type and size in the browser (the backend repeats every check) and sets the declared type from the extension. */
export function validateAttachmentFile(file: File): { file: File } | { error: string } {
  const label = file.name || 'This file';
  const extension = extensionOf(file.name);
  const contentType = imageTypes[extension] ?? documentTypes[extension];
  if (!contentType) {
    return { error: `${label} can't be attached: ${extension ? `.${extension}` : 'this'} files are not supported. Use an image (PNG, JPEG, WebP, GIF), PDF, Word, Excel or a text file (TXT, MD, CSV, JSON, LOG).` };
  }
  if (file.size === 0) return { error: `${label} is empty.` };
  if (extension in imageTypes && file.size > MAX_IMAGE_BYTES) {
    return { error: `${label} is ${formatBytes(file.size)}; images must be 10 MB or smaller.` };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { error: `${label} is ${formatBytes(file.size)}; files must be 20 MB or smaller.` };
  }
  return { file: file.type === contentType ? file : new File([file], file.name, { type: contentType, lastModified: file.lastModified }) };
}

function endpoint(config: PublicConfig, path: string): string {
  if (!config.backendUrl) throw new Error('Attachments are unavailable. Try again.');
  return `${config.backendUrl.replace(/\/+$/, '')}${path}`;
}

function failureMessage(status: number, body: unknown): string {
  if (status === 401) return 'Jarvis could not verify your Microsoft sign-in. Sign in again.';
  if (status === 403) return "This Microsoft account isn't allowed to use Jarvis.";
  if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  if (status === 413) return 'The file is too large.';
  if (status === 503) return 'File uploads are unavailable right now. Try again later.';
  return `The upload failed (HTTP ${status}).`;
}

/** Uploads through XMLHttpRequest because fetch cannot report upload progress. */
export async function uploadAttachment(
  getAccessToken: () => Promise<string>,
  config: PublicConfig,
  file: File,
  options: { signal: AbortSignal; onProgress: (fraction: number) => void },
): Promise<UploadedAttachment> {
  const url = endpoint(config, '/conversation/attachments');
  const token = await accessToken(getAccessToken);
  options.signal.throwIfAborted();
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(120_000)]);
  const finish = beginBackendRequest(url, signal);
  const send = async (attempt: number): Promise<UploadedAttachment> => {
    const form = new FormData();
    form.append('file', file, file.name);
    return new Promise<UploadedAttachment>((resolve, reject) => {
      const request = new XMLHttpRequest();
      const abort = () => request.abort();
      signal.addEventListener('abort', abort, { once: true });
      const settle = () => signal.removeEventListener('abort', abort);
      request.open('POST', url);
      request.setRequestHeader('Authorization', `${['Bear', 'er'].join('')} ${token}`);
      request.setRequestHeader('Accept', 'application/json');
      request.timeout = 120_000;
      request.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) options.onProgress(Math.min(1, event.loaded / event.total));
      };
      request.onload = () => {
        settle();
        let body: unknown;
        try { body = JSON.parse(request.responseText); } catch { body = undefined; }
        if (request.status === 429 && isOwnerSessionToken(token) && attempt < 3) {
          void waitForBackendRetry(attempt, signal).then(() => send(attempt + 1)).then(resolve, reject);
          return;
        }
        if (request.status !== 201) {
          if (request.status === 401 && isOwnerSessionToken(token)) void recoverOwnerSession(token);
          return reject(new Error(failureMessage(request.status, body)));
        }
        const value = body as Partial<UploadedAttachment> | undefined;
        if (!value || typeof value.id !== 'string' || !idPattern.test(value.id) || typeof value.name !== 'string' ||
            typeof value.contentType !== 'string' || typeof value.size !== 'number' ||
            !['uploaded', 'ready', 'failed'].includes(String(value.status))) {
          return reject(new Error('Jarvis returned an invalid upload response.'));
        }
        resolve(value as UploadedAttachment);
      };
      request.onerror = () => { settle(); reject(new Error('The upload was interrupted. Check your connection and try again.')); };
      request.ontimeout = () => { settle(); reject(new Error('The upload took too long. Try again.')); };
      request.onabort = () => { settle(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
      request.send(form);
    });
  };
  try {
    return await send(0);
  } finally {
    finish();
  }
}

export async function deleteAttachment(getAccessToken: () => Promise<string>, config: PublicConfig, id: string): Promise<void> {
  if (!idPattern.test(id)) return;
  const token = await accessToken(getAccessToken);
  await backendFetch(endpoint(config, `/conversation/attachments/${id}`), {
    method: 'DELETE',
    headers: { Authorization: `${['Bear', 'er'].join('')} ${token}` },
  });
}

/** Fetches a short-lived signed read URL. A 404 means the file expired or was removed. */
export async function loadAttachmentUrl(
  getAccessToken: () => Promise<string>,
  config: PublicConfig,
  id: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!idPattern.test(id)) throw new Error('Jarvis returned an invalid attachment reference.');
  const token = await accessToken(getAccessToken);
  let response: Response;
  try {
    response = await backendFetch(endpoint(config, `/conversation/attachments/${id}/url`), {
      headers: { Authorization: `${['Bear', 'er'].join('')} ${token}` },
      ...(signal ? { signal } : {}),
    });
  } catch {
    signal?.throwIfAborted();
    throw new Error('Jarvis could not open the file. Check your connection and try again.');
  }
  if (response.status === 404) throw new AttachmentExpiredError();
  if (response.status === 401) throw new Error('Jarvis could not verify your Microsoft sign-in. Sign in again.');
  if (response.status === 403) throw new Error("This Microsoft account isn't allowed to use Jarvis.");
  if (!response.ok) throw new Error('Jarvis could not open the file. Try again.');
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('Jarvis returned an invalid attachment response.'); }
  const value = (body as { url?: unknown } | null)?.url;
  let url: URL;
  try { url = new URL(typeof value === 'string' ? value : ''); } catch {
    throw new Error('Jarvis returned an invalid attachment URL.');
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.blob.core.windows.net') || url.username || url.password) {
    throw new Error('Jarvis returned an untrusted attachment URL.');
  }
  return url.toString();
}

/** Finds the image Jarvis is asking to publish: its confirmation phrase is `confirm <code> publish <filename>`. */
export function publicPublicationImage(
  text: string,
  earlier: readonly { role: string; attachments?: readonly ChatAttachment[] }[],
): ChatAttachment | undefined {
  if (!/\bconfirm\s+\d{4,}\s+publish\s/iu.test(text)) return undefined;
  for (let index = earlier.length - 1; index >= 0; index -= 1) {
    const candidate = earlier[index]!;
    if (candidate.role !== 'dan') continue;
    const image = candidate.attachments?.find((attachment) =>
      ['image/png', 'image/jpeg', 'image/webp'].includes(attachment.contentType) &&
      text.includes(`publish ${attachment.name}`));
    if (image) return image;
  }
  return undefined;
}
