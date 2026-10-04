import type { ContainerClient } from '@azure/storage-blob';
import { maxCheckLogBytes } from '../github/actions-logs.js';

const requestTimeoutMs = 15_000;

export interface ChecksLoopBlobStore {
  upload(name: string, body: Buffer, signal?: AbortSignal): Promise<void>;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(requestTimeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function createChecksLoopBlobStore(container: ContainerClient): ChecksLoopBlobStore {
  return {
    async upload(name, body, signal) {
      if (!/^check-logs\/[1-9][0-9]{0,18}\/[1-9][0-9]{0,19}\.log$/u.test(name) ||
        body.length === 0 || body.length > maxCheckLogBytes) {
        throw new Error('Check log blob is invalid');
      }
      await container.getBlockBlobClient(name).uploadData(body, {
        abortSignal: requestSignal(signal),
        blobHTTPHeaders: { blobContentType: 'text/plain; charset=utf-8' },
      });
    },
  };
}
