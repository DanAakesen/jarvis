import { describe, expect, it } from 'vitest';
import type { MemoryRecord } from '../../database/memory-store.js';
import { defaultProactiveSettings } from '../store.js';
import { createContextSources } from './context.js';

const at = new Date('2026-11-20T05:00:00.000Z');

function memory(id: string, key: string, content: string, sourceText = 'Remember this preference.'): MemoryRecord {
  return {
    id,
    category: 'preference',
    key,
    content,
    sourceMessageId: '42',
    settingsAction: null,
    sourceText,
    sourceTextTruncated: false,
    revision: 1,
    updatedAt: at,
  };
}

describe('proactive Personal Memory source', () => {
  it('does not send credential-like legacy Memory facts into model context', async () => {
    const memories = [
      memory('1', 'appointments.time', 'Prefers afternoon appointments.'),
      memory('2', 'github_api_token', 'A harmless-looking value.'),
      memory('3', 'appointments.provider', 'Safe looking value.', 'The source includes bearerToken=legacy-secret.'),
    ];
    const memorySource = createContextSources({
      memoryStore: {
        async list() {
          return { memories, hasMore: false };
        },
      },
    }).find(({ id }) => id === 'memory')!;
    const result = await memorySource.read({
      now: at,
      signal: new AbortController().signal,
      settings: defaultProactiveSettings(),
    });
    expect(result.state).toBe('ok');
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.ref).toBe('memory:1');
    expect(result.facts[0]?.text).toContain('afternoon appointments');
    expect(JSON.stringify(result.facts)).not.toContain('api_token');
    expect(JSON.stringify(result.facts)).not.toContain('bearerToken');
  });
});
