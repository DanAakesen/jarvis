import { describe, expect, it, vi } from 'vitest';
import {
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  formatBytes,
  loadAttachmentUrl,
  namePastedFile,
  publicPublicationImage,
  validateAttachmentFile,
  AttachmentExpiredError,
} from './chat-attachments';

const { backendFetch } = vi.hoisted(() => ({ backendFetch: vi.fn() }));
vi.mock('./backend-request', () => ({ backendFetch, beginBackendRequest: () => () => {} }));
vi.mock('./conversation-history', () => ({ accessToken: async () => 'token' }));

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };
const id = '0b0f4a7e-3c1d-4f6a-8b2e-1a2b3c4d5e6f';

function fileOf(name: string, size: number, type = ''): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('validateAttachmentFile', () => {
  it('accepts supported files and declares the type the backend expects', () => {
    const result = validateAttachmentFile(fileOf('notes.md', 10, ''));
    expect('file' in result && result.file.type).toBe('text/markdown');
    const png = validateAttachmentFile(fileOf('shot.PNG', 10, 'image/png'));
    expect('file' in png).toBe(true);
  });

  it('explains unsupported types, empty files and oversize files', () => {
    expect(validateAttachmentFile(fileOf('app.exe', 10))).toMatchObject({ error: expect.stringContaining('.exe files are not supported') });
    expect(validateAttachmentFile(fileOf('photo.heic', 10))).toMatchObject({ error: expect.stringContaining('.heic') });
    expect(validateAttachmentFile(fileOf('empty.txt', 0))).toMatchObject({ error: 'empty.txt is empty.' });
    expect(validateAttachmentFile(fileOf('big.png', MAX_IMAGE_BYTES + 1))).toMatchObject({ error: expect.stringContaining('10 MB or smaller') });
    expect(validateAttachmentFile(fileOf('big.pdf', MAX_DOCUMENT_BYTES + 1))).toMatchObject({ error: expect.stringContaining('20 MB or smaller') });
  });
});

describe('namePastedFile', () => {
  it('names a clipboard screenshot and keeps real file names', () => {
    expect(namePastedFile(fileOf('image.png', 5, 'image/png')).name).toMatch(/^screenshot-\d{8}-\d{6}\.png$/u);
    expect(namePastedFile(fileOf('report.pdf', 5, 'application/pdf')).name).toBe('report.pdf');
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('loadAttachmentUrl', () => {
  it('returns trusted signed URLs and reports expiry', async () => {
    backendFetch.mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://acct.blob.core.windows.net/a/b?sig=x' })));
    await expect(loadAttachmentUrl({} as never, config, id)).resolves.toBe('https://acct.blob.core.windows.net/a/b?sig=x');
    backendFetch.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await expect(loadAttachmentUrl({} as never, config, id)).rejects.toBeInstanceOf(AttachmentExpiredError);
    backendFetch.mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://evil.example.com/x' })));
    await expect(loadAttachmentUrl({} as never, config, id)).rejects.toThrow('untrusted');
  });
});

describe('publicPublicationImage', () => {
  const image = { id, name: 'bug.png', contentType: 'image/png', size: 10 };
  const history = [{ role: 'dan', attachments: [image] }, { role: 'jarvis' }];

  it('matches the confirmation phrase to the earlier image', () => {
    expect(publicPublicationImage('Say exactly "confirm 12345678 publish bug.png".', history)).toEqual(image);
  });

  it('ignores ordinary replies and unknown files', () => {
    expect(publicPublicationImage('I created the issue.', history)).toBeUndefined();
    expect(publicPublicationImage('confirm 12345678 publish other.png', history)).toBeUndefined();
    expect(publicPublicationImage('confirm 12345678 publish bug.png', [{ role: 'dan', attachments: [{ ...image, contentType: 'application/pdf' }] }])).toBeUndefined();
  });
});
