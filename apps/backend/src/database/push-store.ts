import { createHash, randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type { VapidKeyPair } from '../push/webpush.js';
import type { PushSubscriptionInput } from '../push/validation.js';

export interface StoredPushSubscription extends PushSubscriptionInput {
  readonly id: string;
}

export interface ProactiveItem {
  readonly id: string;
  readonly kind: 'test';
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface PushStore {
  readVapidKey(): Promise<VapidKeyPair | undefined>;
  insertVapidKey(keys: VapidKeyPair): Promise<void>;
  upsertSubscription(ownerObjectId: string, subscription: PushSubscriptionInput): Promise<void>;
  deleteSubscription(ownerObjectId: string, endpoint: string): Promise<void>;
  listSubscriptions(ownerObjectId: string): Promise<StoredPushSubscription[]>;
  removeSubscription(id: string): Promise<void>;
  recordSubscriptionResult(id: string, accepted: boolean): Promise<void>;
  createTestItem(ownerObjectId: string): Promise<ProactiveItem>;
  updateItemDelivery(id: string, state: 'accepted' | 'failed', statusCode: number | null): Promise<void>;
  readItem(ownerObjectId: string, id: string): Promise<ProactiveItem | undefined>;
}

interface ItemRow {
  id: string;
  kind: 'test';
  title: string;
  body: string;
  created_at: Date | string;
}

function mapItem(row: ItemRow): ProactiveItem {
  return {
    id: row.id.toLowerCase(),
    kind: row.kind,
    title: row.title,
    body: row.body,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  };
}

export function createPushStore(pool: sql.ConnectionPool): PushStore {
  return {
    async readVapidKey() {
      const { recordset } = await databaseReadRequest(pool).query<VapidKeyPair>(
        'SELECT public_key AS publicKey, private_key AS privateKey FROM dbo.push_vapid_keys WHERE id = 1');
      return recordset[0];
    },
    async insertVapidKey(keys) {
      await pool.request()
        .input('publicKey', sql.VarChar(128), keys.publicKey)
        .input('privateKey', sql.NVarChar(1024), keys.privateKey)
        .query(`IF NOT EXISTS (
          SELECT 1 FROM dbo.push_vapid_keys WITH (UPDLOCK, HOLDLOCK) WHERE id = 1
        )
        INSERT dbo.push_vapid_keys (id, public_key, private_key) VALUES (1, @publicKey, @privateKey);`);
    },
    async upsertSubscription(ownerObjectId, subscription) {
      const endpointHash = createHash('sha256').update(subscription.endpoint).digest('hex');
      await pool.request()
        .input('id', sql.UniqueIdentifier, randomUUID())
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .input('endpointHash', sql.Char(64), endpointHash)
        .input('endpoint', sql.NVarChar(2048), subscription.endpoint)
        .input('p256dh', sql.VarChar(128), subscription.p256dh)
        .input('auth', sql.VarChar(32), subscription.auth)
        .query(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          DECLARE @lockResult int;
          DECLARE @lockResource nvarchar(255) =
            CONCAT(N'jarvis.push-subscriptions:', LOWER(CONVERT(nvarchar(36), @owner)));
          EXEC @lockResult = sys.sp_getapplock
            @Resource = @lockResource,
            @LockMode = 'Exclusive',
            @LockOwner = 'Transaction',
            @LockTimeout = 10000;
          IF @lockResult < 0 THROW 51001, 'Could not acquire owner push subscription lock', 1;
          DECLARE @subscriptionId uniqueidentifier;
          SELECT @subscriptionId = id
            FROM dbo.push_subscriptions WITH (UPDLOCK, HOLDLOCK)
            WHERE owner_object_id = @owner AND endpoint_hash = @endpointHash;
          IF @subscriptionId IS NULL
            INSERT dbo.push_subscriptions (id, owner_object_id, endpoint_hash, endpoint, p256dh, auth)
            VALUES (@id, @owner, @endpointHash, @endpoint, @p256dh, @auth);
          ELSE
            UPDATE dbo.push_subscriptions
              SET endpoint = @endpoint, p256dh = @p256dh, auth = @auth,
                  last_failed_at = NULL, failure_count = 0
              WHERE id = @subscriptionId;
          ;WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (
              ORDER BY CASE WHEN last_accepted_at IS NULL THEN 1 ELSE 0 END,
                last_accepted_at DESC, insertion_seq DESC
            ) AS row_number
            FROM dbo.push_subscriptions WITH (UPDLOCK, HOLDLOCK)
            WHERE owner_object_id = @owner
          )
          DELETE FROM ranked WHERE row_number > 10;
          COMMIT TRANSACTION;`);
    },
    async deleteSubscription(ownerObjectId, endpoint) {
      const endpointHash = createHash('sha256').update(endpoint).digest('hex');
      await pool.request()
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .input('endpointHash', sql.Char(64), endpointHash)
        .query('DELETE FROM dbo.push_subscriptions WHERE owner_object_id = @owner AND endpoint_hash = @endpointHash;');
    },
    async listSubscriptions(ownerObjectId) {
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .query<StoredPushSubscription>(`SELECT TOP (10) id, endpoint, p256dh, auth
          FROM dbo.push_subscriptions
          WHERE owner_object_id = @owner
          ORDER BY insertion_seq;`);
      return recordset.map((row) => ({ ...row, id: row.id.toLowerCase() }));
    },
    async removeSubscription(id) {
      await pool.request().input('id', sql.UniqueIdentifier, id)
        .query('DELETE FROM dbo.push_subscriptions WHERE id = @id;');
    },
    async recordSubscriptionResult(id, accepted) {
      await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('accepted', sql.Bit, accepted)
        .query(`UPDATE dbo.push_subscriptions
          SET last_accepted_at = CASE WHEN @accepted = 1 THEN SYSUTCDATETIME() ELSE last_accepted_at END,
              last_failed_at = CASE WHEN @accepted = 0 THEN SYSUTCDATETIME() ELSE last_failed_at END,
              failure_count = CASE WHEN @accepted = 1 THEN 0 ELSE failure_count + 1 END
          WHERE id = @id;`);
    },
    async createTestItem(ownerObjectId) {
      const id = randomUUID();
      const { recordset } = await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .input('title', sql.NVarChar(200), 'Jarvis')
        .input('body', sql.NVarChar(500), 'New item')
        .query<ItemRow>(`INSERT dbo.proactive_items
          (id, owner_object_id, kind, title, body, delivery_state)
          OUTPUT inserted.id, inserted.kind, inserted.title, inserted.body, inserted.created_at
          VALUES (@id, @owner, N'test', @title, @body, N'queued');`);
      if (!recordset[0]) throw new Error('Proactive test item was not saved');
      return mapItem(recordset[0]);
    },
    async updateItemDelivery(id, state, statusCode) {
      await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('state', sql.NVarChar(20), state)
        .input('statusCode', sql.Int, statusCode)
        .query(`UPDATE dbo.proactive_items
          SET delivery_state = @state, delivery_status_code = @statusCode, delivered_at = NULL
          WHERE id = @id;`);
    },
    async readItem(ownerObjectId, id) {
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .input('id', sql.UniqueIdentifier, id)
        .query<ItemRow>(`UPDATE dbo.proactive_items
          SET opened_at = COALESCE(opened_at, SYSUTCDATETIME())
          OUTPUT inserted.id, inserted.kind, inserted.title, inserted.body, inserted.created_at
          WHERE id = @id AND owner_object_id = @owner;`);
      return recordset[0] ? mapItem(recordset[0]) : undefined;
    },
  };
}
