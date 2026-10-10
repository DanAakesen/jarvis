import { basename } from 'node:path';
import sharp from 'sharp';
import { extractAttachmentText } from './attachment-extraction.js';

export const MAX_ATTACHMENT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENT_REQUEST_BYTES = MAX_ATTACHMENT_DOCUMENT_BYTES + 64 * 1024;

const imageContentTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};
const documentContentTypes: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  log: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export class AttachmentInputError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentInputError';
  }
}

export interface ValidatedAttachment {
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Buffer;
  readonly extension: string;
}

function safeFileName(value: string): string {
  const name = [...basename(value.replaceAll('\\', '/'))]
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return code >= 32 && code !== 127;
    }).join('').trim();
  if (!name || name.length > 255 || name === '.' || name === '..') {
    throw new AttachmentInputError(400, 'A valid file name is required.');
  }
  return name;
}

function imageMagic(bytes: Buffer): 'png' | 'jpeg' | 'webp' | 'gif' | undefined {
  if (bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 6 && /^GIF8[79]a$/u.test(bytes.toString('ascii', 0, 6))) return 'gif';
  return undefined;
}

function rejectBinaryOrMarkup(bytes: Buffer): string {
  if (bytes.length === 0) throw new AttachmentInputError(400, 'The file is empty.');
  const magic = bytes.subarray(0, 8);
  if (magic.toString('ascii', 0, 2) === 'MZ' ||
      magic.toString('hex') === '7f454c4602010100' ||
      ['cafebabe', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe'].includes(magic.toString('hex', 0, 4)) ||
      bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
      bytes.subarray(0, 4).equals(Buffer.from([0x1f, 0x8b, 0x08, 0x00]))) {
    throw new AttachmentInputError(415, 'Archives and executable files are not accepted.');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '');
  } catch {
    throw new AttachmentInputError(415, 'The file content does not match an allowed text type.');
  }
  let start = text.trimStart();
  if (start.startsWith('<?xml')) {
    const declarationEnd = start.indexOf('?>');
    if (declarationEnd >= 0) start = start.slice(declarationEnd + 2).trimStart();
  }
  while (start.startsWith('<!--')) {
    const commentEnd = start.indexOf('-->', 4);
    if (commentEnd < 0) break;
    start = start.slice(commentEnd + 3).trimStart();
  }
  if (/^(?:#!|<\s*(?:!doctype\s+html\b|html\b|head\b|body\b|script\b|svg\b|iframe\b))/iu.test(start)) {
    throw new AttachmentInputError(415, 'HTML and SVG files are not accepted.');
  }
  return text;
}

export async function validateAttachmentFile(input: {
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Buffer;
}): Promise<ValidatedAttachment> {
  const fileName = safeFileName(input.fileName);
  const extension = fileName.split('.').at(-1)?.toLowerCase() ?? '';
  const expectedType = imageContentTypes[extension] ?? documentContentTypes[extension];
  if (!expectedType) throw new AttachmentInputError(415, 'This file type is not accepted.');
  if (input.contentType !== expectedType &&
      !(extension === 'md' && input.contentType === 'text/plain') &&
      !(extension === 'csv' && input.contentType === 'application/csv')) {
    throw new AttachmentInputError(415, 'The file name and declared content type do not match.');
  }
  if (input.bytes.length > MAX_ATTACHMENT_DOCUMENT_BYTES) {
    throw new AttachmentInputError(413, 'The file is larger than the 20 MB limit.');
  }
  const image = imageMagic(input.bytes);
  if (image) {
    const expectedImage = extension === 'jpg' || extension === 'jpeg' ? 'jpeg' : extension;
    if (expectedImage !== image) throw new AttachmentInputError(415, 'The file content does not match its file type.');
    if (input.bytes.length > MAX_ATTACHMENT_IMAGE_BYTES) {
      throw new AttachmentInputError(413, 'Images must be 10 MB or smaller.');
    }
    try {
      const imageProcessor = sharp(input.bytes, {
        animated: false,
        failOn: 'error',
        limitInputPixels: 40_000_000,
      });
      const metadata = await imageProcessor.metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) {
        throw new Error('Image dimensions exceed the limit');
      }
      const format = image === 'jpeg' ? 'jpeg' : image === 'webp' ? 'webp' : 'png';
      const bytes = await imageProcessor.rotate()[format]().toBuffer();
      if (bytes.length > MAX_ATTACHMENT_IMAGE_BYTES) {
        throw new Error('Sanitized image exceeds the size limit');
      }
      return {
        fileName,
        contentType: format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png',
        bytes,
        extension,
      };
    } catch {
      throw new AttachmentInputError(415, 'The image could not be safely decoded.');
    }
  }
  if (extension in imageContentTypes) {
    throw new AttachmentInputError(415, 'The file content does not match its image type.');
  }
  const documentType = documentContentTypes[extension];
  if (!documentType) throw new AttachmentInputError(415, 'This file type is not accepted.');
  if (extension === 'pdf') {
    if (!input.bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new AttachmentInputError(415, 'The file content does not match its PDF type.');
    }
  } else if (extension === 'docx' || extension === 'xlsx') {
    if (!input.bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw new AttachmentInputError(415, 'The file content does not match its Office document type.');
    }
  } else {
    const text = rejectBinaryOrMarkup(input.bytes);
    if (extension === 'json') {
      try {
        JSON.parse(text);
      } catch {
        throw new AttachmentInputError(415, 'The file content is not valid JSON.');
      }
    }
  }
  return { fileName, contentType: documentType, bytes: input.bytes, extension };
}

export async function extractAttachment(
  attachment: ValidatedAttachment,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  if (attachment.extension === 'pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = getDocument({
      data: new Uint8Array(attachment.bytes),
      useSystemFonts: false,
      verbosity: 0,
    });
    const document = await loadingTask.promise;
    const destroyOnAbort = () => { void loadingTask.destroy(); };
    signal.addEventListener('abort', destroyOnAbort, { once: true });
    try {
      if (document.numPages > 100) throw new Error('PDF exceeds the page limit');
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 25); pageNumber += 1) {
        signal.throwIfAborted();
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.flatMap((item) =>
          'str' in item && typeof item.str === 'string' ? [item.str] : []).join(' '));
        if (pages.join('\n').length >= 100_000) break;
      }
      return pages.join('\n').slice(0, 100_000).trim();
    } finally {
      signal.removeEventListener('abort', destroyOnAbort);
      await loadingTask.destroy();
    }
  }
  const text = extractAttachmentText(attachment.extension, attachment.bytes);
  signal.throwIfAborted();
  return text;
}
