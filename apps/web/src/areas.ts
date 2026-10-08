import type { ComponentType } from 'react';
import { FactoryArea } from './factory/FactoryArea';
import { UsagePage } from './usage/UsagePage';
import { KnowledgeArea } from './knowledge/KnowledgeArea';

export interface AreaProps {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
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
  { id: 'knowledge', label: 'Knowledge', path: 'knowledge', navigation: [{ label: 'Knowledge', path: '/knowledge' }], Component: KnowledgeArea },
  { id: 'usage', label: 'Usage', path: 'usage', navigation: [{ label: 'Usage', path: '/usage' }], Component: UsagePage },
];
