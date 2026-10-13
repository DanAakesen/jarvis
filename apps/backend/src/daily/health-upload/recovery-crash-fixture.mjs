// Synthetic killed-process fixture; no production connection or entry point.
import { BlobServiceClient } from '@azure/storage-blob';
import { QueueServiceClient } from '@azure/storage-queue';
import { AzureHealthBuffer } from '../../../dist/daily/health-upload/azure-buffer.js';
const blobs = BlobServiceClient.fromConnectionString(process.env.SYNTHETIC_CONNECTION);
const queues = QueueServiceClient.fromConnectionString(process.env.SYNTHETIC_CONNECTION);
const buffer = new AzureHealthBuffer(blobs.getContainerClient(process.env.SYNTHETIC_RAW),queues.getQueueClient(process.env.SYNTHETIC_QUEUE),process.env.SYNTHETIC_OWNER,
  undefined,{ afterQueue: async () => { process.send?.({ stage: 'queued' }); await new Promise(() => {}); } });
await buffer.recoverOwnedPage({ limit: 1 },AbortSignal.timeout(20000));
