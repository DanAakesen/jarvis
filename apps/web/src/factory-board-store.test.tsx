import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  publishFactoryBoardStatus, publishFactoryBoardUpdate, resetFactoryBoardForTests, useFactoryBoardLiveState,
} from './factory-board-store';

const backendUrl = 'https://api.example.com';
function Observer() {
  const state = useFactoryBoardLiveState();
  return <output>{JSON.stringify(state)}</output>;
}

afterEach(resetFactoryBoardForTests);

describe('Factory board live bridge', () => {
  it('publishes validated, backend-scoped invalidations and clears the old epoch on reconnect', () => {
    const view = render(<Observer />);
    act(() => publishFactoryBoardStatus(backendUrl, 'connected'));
    act(() => publishFactoryBoardUpdate(backendUrl, { projectId: '7', version: 100 }));
    expect(screen.getByRole('status').textContent).toContain('"version":100');
    act(() => publishFactoryBoardStatus(backendUrl, 'reconnecting'));
    expect(screen.getByRole('status').textContent).toContain('"update":null');
    act(() => publishFactoryBoardStatus(backendUrl, 'connected'));
    act(() => publishFactoryBoardUpdate(backendUrl, { projectId: '7', version: 1 }));
    expect(screen.getByRole('status').textContent).toContain('"version":1');
    act(() => publishFactoryBoardStatus('https://other.example.com', 'connecting'));
    expect(screen.getByRole('status').textContent).toContain('"backendUrl":"https://other.example.com"');
    expect(screen.getByRole('status').textContent).toContain('"update":null');
    view.unmount();
  });

  it('does not publish an invalid payload or re-publish an identical invalidation', () => {
    let renders = 0;
    function CountedObserver() {
      const state = useFactoryBoardLiveState();
      renders++;
      return <output>{state.update?.version}</output>;
    }
    render(<CountedObserver />);
    act(() => publishFactoryBoardUpdate(backendUrl, { projectId: '7', version: 1 }));
    const count = renders;
    act(() => publishFactoryBoardUpdate(backendUrl, { projectId: '7', version: 1 }));
    act(() => publishFactoryBoardUpdate(backendUrl, { projectId: '7', version: -1 }));
    expect(renders).toBe(count);
  });
});
