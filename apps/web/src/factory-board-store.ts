import { useSyncExternalStore } from 'react';
import { isFactoryBoardUpdate, type FactoryBoardUpdate } from '@jarvis/contracts';
import type { NowFeedStreamStatus } from './activity';

interface FactoryBoardLiveState {
  backendUrl: string | null;
  status: NowFeedStreamStatus;
  update: FactoryBoardUpdate | null;
}

const initialState: FactoryBoardLiveState = { backendUrl: null, status: 'unavailable', update: null };
let state = initialState;
const listeners = new Set<() => void>();

function publish(next: FactoryBoardLiveState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishFactoryBoardStatus(backendUrl: string, status: NowFeedStreamStatus) {
  if (state.backendUrl === backendUrl && state.status === status && state.update === null) return;
  publish({ backendUrl, status, update: null });
}

export function publishFactoryBoardUpdate(backendUrl: string, value: unknown) {
  if (!isFactoryBoardUpdate(value)) return;
  if (state.backendUrl === backendUrl && state.update?.projectId === value.projectId &&
    state.update.version === value.version) return;
  publish({
    backendUrl,
    status: state.backendUrl === backendUrl ? state.status : 'connecting',
    update: value,
  });
}

export function useFactoryBoardLiveState() {
  return useSyncExternalStore(subscribe, () => state, () => initialState);
}

export function resetFactoryBoardForTests() {
  publish(initialState);
}
