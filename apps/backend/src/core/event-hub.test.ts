import { describe, expect, it, vi } from 'vitest';
import { createEventHub } from './event-hub.js';

describe('event hub', () => {
  it('publishes synchronously to connected listeners and supports unsubscribe', () => {
    const hub = createEventHub<{ id: string }>();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = hub.subscribe(first);
    hub.subscribe(second);

    hub.publish({ id: '1' });
    unsubscribe();
    hub.publish({ id: '2' });

    expect(first.mock.calls).toEqual([[{ id: '1' }]]);
    expect(second.mock.calls).toEqual([[{ id: '1' }], [{ id: '2' }]]);
  });

  it('removes a failing listener without preventing delivery to other listeners', () => {
    const hub = createEventHub<{ id: string }>();
    const healthy = vi.fn();
    const failing = vi.fn(() => { throw new Error('disconnected'); });
    hub.subscribe(failing);
    hub.subscribe(healthy);

    hub.publish({ id: '1' });
    hub.publish({ id: '2' });

    expect(failing).toHaveBeenCalledOnce();
    expect(healthy.mock.calls).toEqual([[{ id: '1' }], [{ id: '2' }]]);
  });
});
