import type { Edge } from './geometry.js';

/** Window-only capabilities. Future backend access needs a separate reviewed boundary. */
export interface WidgetBridge {
  setExpanded(expanded: boolean): Promise<void>;
  dock(edge: Edge): Promise<void>;
  close(): Promise<void>;
}
