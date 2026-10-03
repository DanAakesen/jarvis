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

export interface RecordTaskEventInput {
  taskId: string;
  type: string;
  summary?: string | null;
  payload?: unknown;
  source: TaskEventRecord['source'];
}

export interface TaskDetail extends TaskRecord {
  events: TaskEventRecord[];
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  request: string;
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
  | { kind: 'invalid-transition' };

export interface TaskStore {
  create(input: CreateTaskInput): Promise<TaskRecord | null>;
  list(filters: TaskListFilters): Promise<TaskRecord[]>;
  get(id: string, eventLimit: number, eventOffset: number): Promise<TaskDetail | null>;
  transition(id: string, state: TaskState, completionVerified?: boolean): Promise<TaskTransitionResult>;
  /** Persist the timeline and activity entries atomically, then publish the committed event. */
  recordEvent(event: RecordTaskEventInput): Promise<TaskEventMessage>;
}

export type TaskEventHub = EventHub<TaskEventMessage>;
