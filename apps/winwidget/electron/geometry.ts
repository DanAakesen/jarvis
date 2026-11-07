export interface Bounds { x: number; y: number; width: number; height: number }
export type Edge = 'left' | 'right';
export const EXPANDED_WIDTH = 352;
export const COLLAPSED_WIDTH = 72;
export const WINDOW_HEIGHT = 360;
export const SNAP_DISTANCE = 24;

/** All coordinates are Electron device-independent pixels, including negative monitors. */
export function fitBounds(bounds: Bounds, area: Bounds): Bounds {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    width, height,
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))),
  };
}

export function dockBounds(bounds: Bounds, area: Bounds, edge: Edge): Bounds {
  const fitted = fitBounds(bounds, area);
  return { ...fitted, x: edge === 'left' ? area.x : area.x + area.width - fitted.width };
}

export function snapBounds(bounds: Bounds, area: Bounds): Bounds {
  const left = Math.abs(bounds.x - area.x);
  const right = Math.abs(bounds.x + bounds.width - area.x - area.width);
  if (Math.min(left, right) <= SNAP_DISTANCE) {
    return dockBounds(bounds, area, left <= right ? 'left' : 'right');
  }
  return fitBounds(bounds, area);
}

export function resizeBounds(bounds: Bounds, area: Bounds, expanded: boolean): Bounds {
  const width = expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  // Retain the right anchor when toggling a docked sidebar; otherwise keep the left.
  const right = Math.abs(bounds.x + bounds.width - area.x - area.width) <= SNAP_DISTANCE;
  return fitBounds({ ...bounds, width, x: right ? bounds.x + bounds.width - width : bounds.x }, area);
}
