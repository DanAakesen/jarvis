import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWorkspaceSnapshot } from '@jarvis/contracts';
import { isCommandForThisDevice, readWorkspaceDevice } from './workspace-device';

function matching(...queries: string[]) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: queries.includes(query), media: query }));
}

afterEach(() => vi.unstubAllGlobals());

describe('workspace device', () => {
  it('reports distinct kinds for phone, tablet and desktop', () => {
    matching('(max-width: 700px), (max-height: 500px) and (pointer: coarse)');
    expect(readWorkspaceDevice()).toEqual({ kind: 'phone' });
    matching('(pointer: coarse) and (hover: none)');
    expect(readWorkspaceDevice()).toEqual({ kind: 'tablet' });
    matching();
    expect(readWorkspaceDevice()).toEqual({ kind: 'desktop' });
    expect(isWorkspaceSnapshot({ windows: [], contextPanelOpen: false, device: readWorkspaceDevice() })).toBe(true);
  });

  it('applies untargeted and routed commands but not those named for another kind', () => {
    const base = { commandId: 'c1', operation: 'minimise-all' as const };
    expect(isCommandForThisDevice(base, 'desktop')).toBe(true);
    for (const target of ['active', 'all'] as const) expect(isCommandForThisDevice({ ...base, target }, 'desktop')).toBe(true);
    expect(isCommandForThisDevice({ ...base, target: 'phone' }, 'desktop')).toBe(false);
    expect(isCommandForThisDevice({ ...base, target: 'phone' }, 'phone')).toBe(true);
    expect(isCommandForThisDevice({ ...base, target: 'desktop' }, 'tablet')).toBe(false);
  });
});
