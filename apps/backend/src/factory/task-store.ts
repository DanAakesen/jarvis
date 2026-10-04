import type { EventHub } from '../core/event-hub.js';
import type { TaskState } from './task-lifecycle.js';

export interface TaskRecord {
  id: string;
  projectId: string;
  originMessageId: string | null;
  title: string;
  request: string;
  source: 'board' | 'voice' | 'chat';
  agent: 'codex' | 'copilot';
  modelOverride: string | null;
  reasoningOverride: string | null;
  state: TaskState;
  activity: string | null;
  priority: number;
  attemptCount: number;
  nextAttemptAt: string | null;
  branch: string | null;
  latestSessionEndReason?: 'done' | 'cancelled' | 'crashed' | 'idle' | 'idle_expired' | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TaskEventRecord {
  id: string;
  type: string;
  summary: string | null;
  payload: unknown;
  payloadTruncated: boolean;
  source: 'runner' | 'backend' | 'github' | 'dan';
  at: string;
}

export interface TaskEventMessage extends TaskEventRecord {
  taskId: string;
}

export interface TaskUsageRecord {
  id: string | null;
  source: 'sandbox' | 'jarvis_model' | 'voice' | 'codex' | 'copilot';
  metric: 'minutes' | 'input_tokens' | 'output_tokens' | 'turns' | 'premium_requests';
  quantity: number;
  costDkk: number | null;
  sandboxSessionId: string | null;
  at: string;
  estimated: boolean;
}

export interface RecordTaskEventInput {
  taskId: string;
  type: string;
  summary?: string | null;
  payload?: unknown;
  source: TaskEventRecord['source'];
}

export interface TaskDetail extends TaskRecord {
  events: TaskEventRecord[];
  usage: TaskUsageRecord[];
}

export interface RunningTaskContext {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  agent: TaskRecord['agent'];
  state: TaskRecord['state'];
  activity: string | null;
  startedAt: string | null;
  recentEvents: {
    type: string;
    summary: string | null;
    summaryTruncated: boolean;
    source: TaskEventRecord['source'];
    at: string;
  }[];
}

export interface RunningTaskContextSnapshot {
  runningTasks: RunningTaskContext[];
  truncated: boolean;
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  request: string;
  source?: 'board' | 'chat';
  originMessageId?: string;
  agent?: 'codex' | 'copilot';
  modelOverride?: string;
  reasoningOverride?: string;
  priority?: number;
}

export interface TaskListFilters {
  projectId?: string;
  agent?: 'codex' | 'copilot';
  state?: TaskState;
  createdAfter?: string;
  createdBefore?: string;
  search?: string;
  limit: number;
  offset: number;
}

export type TaskTransitionResult =
  | { kind: 'ok'; task: TaskRecord }
  | { kind: 'not-found' }
  | { kind: 'credential-unavailable' }
  | { kind: 'renewal-active' }
  | { kind: 'invalid-transition' };

export type ActiveTaskGuardResult<T> =
  | { kind: 'active' }
  | { kind: 'idle'; value: T };

export interface TaskStore {
  create(input: CreateTaskInput): Promise<TaskRecord | null>;
  list(filters: TaskListFilters): Promise<TaskRecord[]>;
  get(id: string, eventLimit: number, eventOffset: number): Promise<TaskDetail | null>;
  getActiveRepository(id: string, foundrySessionId: string): Promise<string | null>;
  getEventsAfter(taskId: string, eventId: string, limit: number): Promise<TaskEventMessage[]>;
  getRunningContext(): Promise<RunningTaskContextSnapshot>;
  transition(id: string, state: TaskState, completionVerified?: boolean, eventReason?: string): Promise<TaskTransitionResult>;
  withNoActiveTasks<T>(operation: () => Promise<T>): Promise<ActiveTaskGuardResult<T>>;
  /** Persist the timeline and activity entries atomically, then publish the committed event. */
  recordEvent(event: RecordTaskEventInput): Promise<TaskEventMessage>;
}

export type TaskControlCommand =
  | { action: 'steer'; message: string }
  | { action: 'pause' | 'resume' | 'cancel' | 'recover' };

export type TaskControlResult =
  | { kind: 'ok'; task: TaskRecord }
  | { kind: 'not-found' }
  | { kind: 'invalid-transition' }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

export interface TaskController {
  control(taskId: string, command: TaskControlCommand): Promise<TaskControlResult>;
}

export type TaskEventHub = EventHub<TaskEventMessage>;
