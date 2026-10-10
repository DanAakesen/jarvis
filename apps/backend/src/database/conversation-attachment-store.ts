import { createHash, randomUUID } from 'node:crypto';
import type { ContainerClient } from '@azure/storage-blob';
import sql from 'mssql';
import type { WorkspaceArtifactStore } from './workspace-artifact-store.js';
import { databaseReadRequest } from './wake-retry.js';

const attachmentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const maxReadCharacters = 4_000;
const maxListItems = 50;

export interface ConversationAttachmentMetadata {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
}

export interface ConversationAttachmentContext extends ConversationAttachmentMetadata {
  readonly status: 'uploaded' | 'ready' | 'failed';
  readonly context: string;
}

interface ConversationAttachmentRow {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  blob_name: string;
  status: 'uploaded' | 'ready' | 'failed';
  extracted_text: string | null;
  description: string | null;
  created_at: Date;
}

export interface ConversationAttachmentStoreOptions {
  readonly pool: sql.ConnectionPool;
  readonly container: ContainerClient;
  readonly storageAccount: string;
  readonly artifacts: Pick<WorkspaceArtifactStore, 'privateReadUrl'>;
  readonly retentionDays: number;
  readonly now?: () => Date;
  readonly createReadUrl?: (blobName: string, signal: AbortSignal) => Promise<string>;
}

export function attachmentRetentionDays(value = process.env.CONVERSATION_ATTACHMENT_RETENTION_DAYS): number {
  if (value === undefined || value.trim() === '') return 30;
  if (!/^\d{1,2}$/u.test(value)) throw new Error('CONVERSATION_ATTACHMENT_RETENTION_DAYS must be between 1 and 90');
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error('CONVERSATION_ATTACHMENT_RETENTION_DAYS must be between 1 and 90');
  }
  return days;
}

function attachmentId(value: string): boolean {
  return attachmentIdPattern.test(value);
}

function ownerId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

export class ConversationAttachmentStore {
  private readonly now: () => Date;
  private readonly createReadUrl: (blobName: string, signal: AbortSignal) => Promise<string>;
  readonly retentionDays: number;

  constructor(private readonly options: ConversationAttachmentStoreOptions) {
    if (!/^[a-z0-9]{3,24}$/u.test(options.storageAccount) ||
        !Number.isInteger(options.retentionDays) || options.retentionDays < 1 || options.retentionDays > 90) {
      throw new TypeError('Invalid conversation attachment store settings');
    }
    this.retentionDays = options.retentionDays;
    this.now = options.now ?? (() => new Date());
    this.createReadUrl = options.createReadUrl ??
      ((blobName, signal) => options.artifacts.privateReadUrl(blobName, signal));
  }

  async saveUpload(input: {
    readonly ownerObjectId: string;
    readonly fileName: string;
    readonly contentType: string;
    readonly bytes: Buffer;
  }): Promise<ConversationAttachmentMetadata> {
    if (!ownerId(input.ownerObjectId)) throw new TypeError('Invalid conversation attachment owner');
    const id = randomUUID().toLowerCase();
    const blobName = `attachments/${id}`;
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1_000);
    const blob = this.options.container.getBlockBlobClient(blobName);
    let uploaded = false;
    try {
      await blob.uploadData(input.bytes, {
        abortSignal: AbortSignal.timeout(30_000),
        blobHTTPHeaders: {
          blobContentType: input.contentType,
          blobContentDisposition: 'attachment',
          blobCacheControl: 'private, no-store',
        },
      });
      uploaded = true;
      await this.options.pool.request()
        .input('id', sql.VarChar(36), id)
        .input('owner', sql.UniqueIdentifier, input.ownerObjectId.toLowerCase())
        .input('fileName', sql.NVarChar(255), input.fileName)
        .input('contentType', sql.NVarChar(127), input.contentType)
        .input('size', sql.Int, input.bytes.length)
        .input('sha256', sql.Char(64), sha256)
        .input('blobName', sql.NVarChar(256), blobName)
        .input('createdAt', sql.DateTime2(7), createdAt)
        .input('expiresAt', sql.DateTime2(7), expiresAt)
        .query(`INSERT dbo.conversation_attachments
            (id, owner_object_id, file_name, content_type, size_bytes, sha256, blob_name, status, created_at, expires_at)
          VALUES (@id, @owner, @fileName, @contentType, @size, @sha256, @blobName, N'uploaded', @createdAt, @expiresAt);`);
      return { id, name: input.fileName, contentType: input.contentType, size: input.bytes.length };
    } catch (error) {
      if (uploaded) await blob.deleteIfExists({ abortSignal: AbortSignal.timeout(15_000) }).catch(() => undefined);
      throw error;
    }
  }

  async complete(
    id: string,
    ownerObjectId: string,
    result: { readonly status: 'ready' | 'failed'; readonly extractedText?: string; readonly description?: string },
  ): Promise<void> {
    if (!attachmentId(id) || !ownerId(ownerObjectId)) throw new TypeError('Invalid conversation attachment reference');
    await this.options.pool.request()
      .input('id', sql.VarChar(36), id)
      .input('owner', sql.UniqueIdentifier, ownerObjectId)
      .input('status', sql.NVarChar(16), result.status)
      .input('extractedText', sql.NVarChar(sql.MAX), result.extractedText ?? null)
      .input('description', sql.NVarChar(sql.MAX), result.description ?? null)
      .query(`UPDATE dbo.conversation_attachments
        SET status = @status, extracted_text = @extractedText, description = @description
        WHERE id = @id AND owner_object_id = @owner AND message_id IS NULL;`);
  }

  async getModelContext(
    ownerObjectId: string,
    ids: readonly string[],
  ): Promise<ConversationAttachmentContext[]> {
    if (ids.length === 0) return [];
    const request = databaseReadRequest(this.options.pool).input('owner', sql.UniqueIdentifier, ownerObjectId);
    ids.forEach((id, index) => request.input(`id${index}`, sql.VarChar(36), id));
    const list = ids.map((_, index) => `@id${index}`).join(', ');
    const { recordset } = await request.query<ConversationAttachmentRow>(`SELECT id, file_name, content_type,
        size_bytes, sha256, blob_name, status, extracted_text, description, created_at
      FROM dbo.conversation_attachments
      WHERE owner_object_id = @owner AND id IN (${list}) AND message_id IS NULL
        AND expires_at > SYSUTCDATETIME();`);
    const byId = new Map(recordset.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      return [{
        id: row.id,
        name: row.file_name,
        contentType: row.content_type,
        size: row.size_bytes,
        status: row.status,
        context: row.status === 'failed'
          ? 'File content could not be extracted.'
          : (row.description ?? row.extracted_text ?? '').slice(0, 2_000),
      }];
    });
  }

  async list(ownerObjectId: string): Promise<(ConversationAttachmentMetadata & {
    readonly status: 'uploaded' | 'ready' | 'failed';
    readonly createdAt: string;
  })[]> {
    const { recordset } = await databaseReadRequest(this.options.pool)
      .input('owner', sql.UniqueIdentifier, ownerObjectId)
      .input('take', sql.Int, maxListItems)
      .query<ConversationAttachmentRow>(`SELECT TOP (@take) id, file_name, content_type, size_bytes,
          sha256, blob_name, status, extracted_text, description, created_at
        FROM dbo.conversation_attachments
        WHERE owner_object_id = @owner AND message_id IS NOT NULL
          AND expires_at > SYSUTCDATETIME()
        ORDER BY created_at DESC, id DESC;`);
    return recordset.map((row) => ({
      id: row.id,
      name: row.file_name,
      contentType: row.content_type,
      size: row.size_bytes,
      status: row.status,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async read(ownerObjectId: string, id: string, offset = 0, query?: string): Promise<{
    readonly id: string;
    readonly name: string;
    readonly contentType: string;
    readonly size: number;
    readonly status: 'uploaded' | 'ready' | 'failed';
    readonly content: string;
    readonly offset: number;
    readonly nextOffset: number | null;
  } | null> {
    if (!attachmentId(id) || !Number.isInteger(offset) || offset < 0 || offset > 100_000 ||
        (query !== undefined && (!query.trim() || query.length > 200))) return null;
    const { recordset } = await databaseReadRequest(this.options.pool)
      .input('id', sql.VarChar(36), id)
      .input('owner', sql.UniqueIdentifier, ownerObjectId)
      .query<ConversationAttachmentRow>(`SELECT id, file_name, content_type, size_bytes,
          sha256, blob_name, status, extracted_text, description, created_at
        FROM dbo.conversation_attachments
        WHERE id = @id AND owner_object_id = @owner AND message_id IS NOT NULL
          AND expires_at > SYSUTCDATETIME();`);
    const row = recordset[0];
    if (!row) return null;
    const fullText = row.description ?? row.extracted_text ?? '';
    if (row.status === 'failed' || row.status === 'uploaded') {
      return {
        id: row.id, name: row.file_name, contentType: row.content_type, size: row.size_bytes,
        status: row.status, content: 'File content is not available; it could not be extracted.',
        offset: 0, nextOffset: null,
      };
    }
    if (query !== undefined && row.description) {
      return {
        id: row.id, name: row.file_name, contentType: row.content_type, size: row.size_bytes,
        status: row.status, content: row.description.slice(0, 2_000), offset: 0, nextOffset: null,
      };
    }
    const queryOffset = query === undefined ? offset :
      Math.max(0, fullText.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) - 1_000);
    if (query !== undefined && !fullText.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
      return {
        id: row.id, name: row.file_name, contentType: row.content_type, size: row.size_bytes,
        status: row.status, content: 'No matching text was found in this file.',
        offset: 0, nextOffset: null,
      };
    }
    const content = fullText.slice(queryOffset, queryOffset + maxReadCharacters);
    const nextOffset = query === undefined && queryOffset + content.length < fullText.length
      ? queryOffset + content.length
      : null;
    return {
      id: row.id, name: row.file_name, contentType: row.content_type, size: row.size_bytes,
      status: row.status, content, offset: queryOffset, nextOffset,
    };
  }

  async readUrl(ownerObjectId: string, id: string, signal: AbortSignal): Promise<string | null> {
    if (!attachmentId(id)) return null;
    const { recordset } = await databaseReadRequest(this.options.pool)
      .input('id', sql.VarChar(36), id)
      .input('owner', sql.UniqueIdentifier, ownerObjectId)
      .query<{ blob_name: string }>(`SELECT blob_name FROM dbo.conversation_attachments
        WHERE id = @id AND owner_object_id = @owner AND expires_at > SYSUTCDATETIME();`);
    const blobName = recordset[0]?.blob_name;
    if (!blobName?.startsWith(`attachments/${id}`)) return null;
    return this.createReadUrl(blobName, signal);
  }

  async delete(ownerObjectId: string, id: string): Promise<boolean> {
    if (!attachmentId(id)) return false;
    const result = await databaseReadRequest(this.options.pool)
      .input('id', sql.VarChar(36), id)
      .input('owner', sql.UniqueIdentifier, ownerObjectId)
      .query<{ blob_name: string }>(`SELECT blob_name FROM dbo.conversation_attachments
        WHERE id = @id AND owner_object_id = @owner;`);
    const blobName = result.recordset[0]?.blob_name;
    if (!blobName) return false;
    await this.options.container.getBlockBlobClient(blobName).deleteIfExists({
      abortSignal: AbortSignal.timeout(15_000),
    });
    const removed = await this.options.pool.request()
      .input('id', sql.VarChar(36), id)
      .input('owner', sql.UniqueIdentifier, ownerObjectId)
      .query(`DELETE dbo.conversation_attachments WHERE id = @id AND owner_object_id = @owner;`);
    return (removed.rowsAffected[0] ?? 0) > 0;
  }

  async cleanupExpired(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new TypeError('Invalid cleanup limit');
    const { recordset } = await databaseReadRequest(this.options.pool)
      .input('take', sql.Int, limit)
      .query<{ id: string; blob_name: string }>(`SELECT TOP (@take) id, blob_name
        FROM dbo.conversation_attachments
        WHERE expires_at <= SYSUTCDATETIME()
        ORDER BY expires_at, id;`);
    let removed = 0;
    for (const row of recordset) {
      try {
        await this.options.container.getBlockBlobClient(row.blob_name).deleteIfExists({
          abortSignal: AbortSignal.timeout(15_000),
        });
        const result = await this.options.pool.request()
          .input('id', sql.VarChar(36), row.id)
          .input('blobName', sql.NVarChar(256), row.blob_name)
          .query(`DELETE dbo.conversation_attachments
            WHERE id = @id AND blob_name = @blobName AND expires_at <= SYSUTCDATETIME();`);
        if ((result.rowsAffected[0] ?? 0) > 0) removed += 1;
      } catch {
        continue;
      }
    }
    return removed;
  }
}
