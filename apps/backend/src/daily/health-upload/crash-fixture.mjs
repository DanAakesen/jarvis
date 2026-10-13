// Synthetic child-process fixture only. Not a production entry point/configuration.
import { BlobServiceClient } from '@azure/storage-blob';
import { QueueServiceClient } from '@azure/storage-queue';
import { AzureHealthBuffer,createBlobHealthVerifier } from '../../../dist/daily/health-upload/azure-buffer.js';
import { buildHealthUploadServer } from '../../../dist/daily/health-upload/server.js';
const blobs = BlobServiceClient.fromConnectionString(process.env.SYNTHETIC_CONNECTION);
const queues = QueueServiceClient.fromConnectionString(process.env.SYNTHETIC_CONNECTION);
const halt = async () => { process.send?.({ stage: process.env.SYNTHETIC_STAGE }); await new Promise(() => {}); };
const faults = process.env.SYNTHETIC_STAGE === 'raw' ? { afterRaw: halt } : { afterManifest: halt };
const app = buildHealthUploadServer({ enabled: true,
  buffer: new AzureHealthBuffer(blobs.getContainerClient(process.env.SYNTHETIC_RAW),queues.getQueueClient(process.env.SYNTHETIC_QUEUE),process.env.SYNTHETIC_OWNER,undefined,faults),
  verifier: createBlobHealthVerifier(blobs.getContainerClient(process.env.SYNTHETIC_AUTH)) });
const address = await app.listen({ host: '127.0.0.1',port: 0 });
process.send?.({ address });
