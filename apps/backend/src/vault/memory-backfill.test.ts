import { describe, expect, it, vi } from 'vitest';
import type { MemoryRecord, MemoryStore } from '../database/memory-store.js';
import { backfillPersonalMemoryEmbeddings } from './index.js';

const at = new Date('2026-11-20T05:00:00.000Z');

function memory(
  id: string,
  key: string,
  content: string,
  sourceText = 'Remember this preference.',
): MemoryRecord {
  return {
    id,
    category: 'preference',
    key,
    content,
    sourceMessageId: id,
    settingsAction: null,
    sourceText,
    sourceTextTruncated: false,
    revision: 1,
    updatedAt: at,
  };
}

describe('Personal Memory embedding backfill', () => {
  it('quarantines credential-like legacy rows before provider submission', async () => {
    const records = [
      memory('1', 'appointments.time', 'Prefers afternoon appointments.'),
      memory('2', 'github_api_token', 'An innocuous-looking value.'),
      memory('3', 'appointments.provider', 'Another innocuous value.', 'The old source contains bearerToken=legacy-secret.'),
    ];
    const quarantined = new Set<string>();
    const updated = new Set<string>();
    const store = {
      async embeddingsToBackfill(_model, afterId, limit) {
        return records.filter((record) =>
          BigInt(record.id) > BigInt(afterId) &&
          !quarantined.has(record.id) &&
          !updated.has(record.id),
        ).slice(0, limit);
      },
      async quarantineEmbedding(memoryId) {
        quarantined.add(memoryId);
        return true;
      },
      async updateEmbedding(memoryId) {
        updated.add(memoryId);
        return true;
      },
    } satisfies Pick<MemoryStore, 'embeddingsToBackfill' | 'quarantineEmbedding' | 'updateEmbedding'>;
    const embed = vi.fn(async () => Array.from({ length: 1536 }, () => 0));
    const result = await backfillPersonalMemoryEmbeddings({
      store,
      model: 'fixture-embedding',
      signal: new AbortController().signal,
      embed,
      progress: async () => {},
    });

    expect(result).toMatchObject({ updated: 1, quarantined: 2, processed: 3, pending: false });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith('Prefers afternoon appointments.', expect.any(AbortSignal));
    expect([...quarantined]).toEqual(['2', '3']);
    expect([...updated]).toEqual(['1']);
  });
});
