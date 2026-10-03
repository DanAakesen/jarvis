import type { ComponentType } from 'react';
import { FactoryArea } from './factory/FactoryArea';

export interface Area {
  id: string;
  label: string;
  /** Top-level path segment; the area's component renders its own nested routes. */
  path: string;
  Component: ComponentType;
}

/** Phase 1 has one area. A later area adds its folder and one entry here; the shell is unchanged. */
export const areas: readonly Area[] = [
  { id: 'factory', label: 'Software Factory', path: 'factory', Component: FactoryArea },
];
