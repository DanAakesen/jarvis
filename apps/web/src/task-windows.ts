import { createContext, useContext } from 'react';

/** A Software Factory task shown as a workspace window. Open windows survive reloads as pinned tabs. */
export interface TaskWindowEntry { taskId: string; title: string }

export interface TaskWindows {
  open: (taskId: string, title?: string) => void;
  setTitle: (taskId: string, title: string) => void;
}

export const TaskWindowsContext = createContext<TaskWindows | null>(null);

export function useTaskWindows() {
  return useContext(TaskWindowsContext);
}

const storageKey = 'jarvis.windows.tasks';
const taskIdPattern = /^\d{1,19}$/u;

export function taskWindowViewId(taskId: string) {
  return `task-${taskId}`;
}

export function readTaskWindows(): TaskWindowEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const { taskId, title } = entry as Record<string, unknown>;
      if (typeof taskId !== 'string' || !taskIdPattern.test(taskId)) return [];
      return [{ taskId, title: typeof title === 'string' && title.trim() ? title.slice(0, 200) : `Task ${taskId}` }];
    }).slice(0, 12);
  } catch {
    return [];
  }
}

export function saveTaskWindows(entries: readonly TaskWindowEntry[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(entries.slice(0, 12)));
  } catch {
    // Storage can be full or blocked; windows then simply do not survive a reload.
  }
}

export function isTaskId(value: string) {
  return taskIdPattern.test(value);
}
