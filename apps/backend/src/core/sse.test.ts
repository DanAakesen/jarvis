import { describe, expect, it, vi } from 'vitest';
import { writeSseEvent } from './sse.js';

describe('writeSseEvent', () => {
  it('serializes Now and task stream events with their established SSE frames', () => {
    const write = vi.fn(() => true);
    const response = { write };

    expect(writeSseEvent(response, { event: 'mode', data: {} })).toBe(true);
    expect(writeSseEvent(response, {
      event: 'task',
      id: '42',
      data: {
        id: '42',
        taskId: '7',
        type: 'state_changed',
        summary: null,
        payload: { to: 'Running' },
        payloadTruncated: false,
        source: 'backend',
        at: '2026-10-07T12:00:00.000Z',
      },
    })).toBe(true);

    expect(write.mock.calls).toEqual([
      ['event: mode\ndata: {}\n\n'],
      ['id: 42\nevent: task\ndata: {"id":"42","taskId":"7","type":"state_changed","summary":null,"payload":{"to":"Running"},"payloadTruncated":false,"source":"backend","at":"2026-10-07T12:00:00.000Z"}\n\n'],
    ]);
  });
});
