import type { ComponentType } from 'react';
import { FactoryArea } from './factory/FactoryArea';
import { UsagePage } from './usage/UsagePage';
import { NotesArea } from './notes/NotesArea';
import { StatusPage } from './status/StatusPage';
import { DailyHome } from './daily/DailyHome';
import { ProactiveArea } from './ProactiveArea';
import { TasksArea } from './tasks/TasksArea';

export interface AreaProps {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  signIn?: () => Promise<void>;
}

export interface Area {
  id: string;
  label: string;
  /** Top-level path segment; the area's component renders its own nested routes. */
  path: string;
  navigation: readonly { label: string; path: string }[];
  Component: ComponentType<AreaProps>;
}

/** Phase 1 has one area. A later area adds its folder and one entry here; the shell is unchanged. */
export const areas: readonly Area[] = [
  {
    id: 'factory',
    label: 'Software Factory',
    path: 'factory',
    navigation: [
      { label: 'Kanban', path: '/factory/kanban' },
    ],
    Component: FactoryArea,
  },
  { id: 'tasks', label: 'Tasks', path: 'tasks', navigation: [{ label: 'Tasks', path: '/tasks' }], Component: TasksArea },
  { id: 'notes', label: 'Notes', path: 'notes', navigation: [{ label: 'Notes', path: '/notes' }], Component: NotesArea },
  { id: 'usage', label: 'Usage', path: 'usage', navigation: [{ label: 'Usage', path: '/usage' }], Component: UsagePage },
  { id: 'status', label: 'Status', path: 'status', navigation: [{ label: 'Status', path: '/status' }], Component: StatusPage },
];

const withDaily: readonly Area[] = [
  { id: 'daily', label: 'Daily', path: 'daily', navigation: [{ label: 'Daily', path: '/daily' }], Component: DailyHome },
  ...areas,
];

const proactiveArea: Area = {
  id: 'proactive',
  label: 'Proactive',
  path: 'proactive',
  navigation: [{ label: 'Proactive', path: '/proactive' }],
  Component: ProactiveArea,
};

/** Trusted inactive-source composition; never enabled by a URL or a second login. */
export function appAreas(dailyEnabled = false, proactiveEnabled = false): readonly Area[] {
  const base = dailyEnabled ? withDaily : areas;
  return proactiveEnabled ? [base[0]!, proactiveArea, ...base.slice(1)] : base;
}
