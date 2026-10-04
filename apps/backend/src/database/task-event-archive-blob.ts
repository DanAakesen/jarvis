import type { ContainerClient } from '@azure/storage-blob';
import {
  taskEventArchiveBlobSizeLimit,
  type TaskEventArchiveBlobStore,
} from './task-event-archive.js';

const requestTimeoutMs = 15_000;

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(requestTimeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function createTaskEventArchiveBlobStore(container: ContainerClient): TaskEventArchiveBlobStore {
  return {
    async upload(name, body, signal) {
      await container.getBlockBlobClient(name).uploadData(body, {
        abortSignal: requestSignal(signal),
        blobHTTPHeaders: { blobContentType: 'application/json' },
      });
    },
    async download(name, signal) {
      const body = await container.getBlockBlobClient(name)
        .downloadToBuffer(0, taskEventArchiveBlobSizeLimit + 1, { abortSignal: requestSignal(signal) });
      if (body.length > taskEventArchiveBlobSizeLimit) {
        throw new Error('Task event archive blob exceeds size limit');
      }
      return body;
    },
  };
}
