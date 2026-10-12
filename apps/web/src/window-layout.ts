import type { WorkspaceArrangeLayout, WorkspaceWindowRegion } from '@jarvis/contracts';

// Window management by intent (P8-42, #430, Dan 8 October). The page arranges windows itself; Jarvis names intents
// (place left, side by side, stack, tidy up) and this module turns them into rectangles. Every rectangle is a fraction
// of the window area, matching the Workspace geometry model. Pure: no DOM, no React.

export const windowRegions = ['left', 'right', 'top', 'bottom', 'centre', 'full'] as const;
export type WindowRegion = WorkspaceWindowRegion;
export const windowLayouts = ['auto', 'side-by-side', 'grid', 'cascade'] as const;
export type WindowLayout = WorkspaceArrangeLayout;

/** auto: arranged by the engine; region: holds a named part of the screen; manual: dragged or resized, left alone. */
export type WindowPlacement = { mode: 'auto' } | { mode: 'region'; region: WindowRegion } | { mode: 'manual' };
export type WindowRect = { x: number; y: number; width: number; height: number };

/** Side by side falls back to a cascade rather than squeezing a window below this width. */
export const minWindowWidthPx = 480;
const cascadeStepPx = 32;
const gap = 0.012;

const round = (value: number) => Math.round(value * 1000) / 1000;
const rect = (x: number, y: number, width: number, height: number): WindowRect =>
  ({ x: round(x), y: round(y), width: round(width), height: round(height) });

export function regionRect(region: WindowRegion): WindowRect {
  switch (region) {
    case 'left': return rect(0, 0, 0.5 - gap / 2, 1);
    case 'right': return rect(0.5 + gap / 2, 0, 0.5 - gap / 2, 1);
    case 'top': return rect(0, 0, 1, 0.5 - gap / 2);
    case 'bottom': return rect(0, 0.5 + gap / 2, 1, 0.5 - gap / 2);
    case 'centre': return rect(0.14, 0.06, 0.72, 0.86);
    case 'full': return rect(0, 0, 1, 1);
  }
}

/** The part of the area left for auto windows once left/right/top/bottom regions are taken. */
function freeArea(taken: readonly WindowRegion[]): WindowRect {
  let x = 0;
  let y = 0;
  let right = 1;
  let bottom = 1;
  if (taken.includes('left')) x = 0.5 + gap / 2;
  if (taken.includes('right')) right = 0.5 - gap / 2;
  if (taken.includes('top')) y = 0.5 + gap / 2;
  if (taken.includes('bottom')) bottom = 0.5 - gap / 2;
  // Opposite halves both taken leave nothing useful: auto windows then cascade over the whole area.
  if (right - x < 0.3 || bottom - y < 0.3) return rect(0, 0, 1, 1);
  return rect(x, y, right - x, bottom - y);
}

function columns(area: WindowRect, count: number): WindowRect[] {
  const width = (area.width - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) => rect(area.x + index * (width + gap), area.y, width, area.height));
}

function grid(area: WindowRect, count: number): WindowRect[] {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const width = (area.width - gap * (cols - 1)) / cols;
  const height = (area.height - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, index) => rect(
    area.x + (index % cols) * (width + gap),
    area.y + Math.floor(index / cols) * (height + gap),
    width,
    height,
  ));
}

/** Overlapping cards stepped down and right, with compressed spacing instead of duplicate positions on small areas. */
function cascade(area: WindowRect, count: number, size: { width: number; height: number }): WindowRect[] {
  const width = Math.min(area.width, Math.max(0.5, area.width * 0.7));
  const height = Math.min(area.height, area.height * 0.78);
  const steps = Math.max(1, count - 1);
  const stepX = Math.min(cascadeStepPx / Math.max(1, size.width), (area.width - width) / steps);
  const stepY = Math.min(cascadeStepPx / Math.max(1, size.height), (area.height - height) / steps);
  const startX = area.x + (area.width - width - (count - 1) * stepX) / 2;
  const startY = area.y + (area.height - height - (count - 1) * stepY) / 2;
  return Array.from({ length: count }, (_, index) => rect(startX + index * stepX, startY + index * stepY, width, height));
}

function fits(area: WindowRect, count: number, size: { width: number }) {
  return (area.width * size.width - gap * size.width * (count - 1)) / count >= minWindowWidthPx;
}

/** Smart fit: one large and centred, two side by side, three = one big left plus two stacked right, four a grid. */
function smartFit(area: WindowRect, count: number, size: { width: number; height: number }): WindowRect[] {
  if (count === 0) return [];
  if (count === 1) {
    // Sharing the screen with a placed window, the one auto window takes the whole free part.
    if (area.width < 1 || area.height < 1) return [area];
    const width = area.width * 0.74 * size.width >= minWindowWidthPx ? area.width * 0.74 : area.width;
    const height = area.height * 0.88;
    return [rect(area.x + (area.width - width) / 2, area.y + (area.height - height) / 2, width, height)];
  }
  if (count === 2 && fits(area, 2, size)) return columns(area, 2);
  if (count === 3 && (area.width - gap) * 0.42 * size.width >= minWindowWidthPx) {
    const big = (area.width - gap) * 0.58;
    const side = area.width - big - gap;
    const half = (area.height - gap) / 2;
    return [
      rect(area.x, area.y, big, area.height),
      rect(area.x + big + gap, area.y, side, half),
      rect(area.x + big + gap, area.y + half + gap, side, half),
    ];
  }
  if (count === 4 && fits(area, 2, size)) return grid(area, 4);
  return cascade(area, count, size);
}

function arranged(layout: WindowLayout, area: WindowRect, count: number, size: { width: number; height: number }): WindowRect[] {
  switch (layout) {
    case 'auto': return smartFit(area, count, size);
    case 'cascade': return cascade(area, count, size);
    case 'grid': return fits(area, Math.ceil(Math.sqrt(count)), size) ? grid(area, count) : cascade(area, count, size);
    case 'side-by-side':
      return fits(area, count, size) ? columns(area, count) : cascade(area, count, size);
  }
}

/**
 * Rectangles for every non-manual window. `ids` is the layout order (left to right, back to front); `size` is the
 * window area in CSS pixels, used for the minimum width and the cascade step. Manual windows are omitted.
 */
export function layoutWindows({ ids, placements, layout, size }: {
  ids: readonly string[];
  placements: Readonly<Record<string, WindowPlacement | undefined>>;
  layout: WindowLayout;
  size: { width: number; height: number };
}): Record<string, WindowRect> {
  const result: Record<string, WindowRect> = {};
  const taken: WindowRegion[] = [];
  const auto: string[] = [];
  for (const id of ids) {
    const placement = placements[id] ?? { mode: 'auto' };
    if (placement.mode === 'region') {
      result[id] = regionRect(placement.region);
      taken.push(placement.region);
    } else if (placement.mode === 'auto') {
      auto.push(id);
    }
  }
  const area = freeArea(taken);
  arranged(layout, area, auto.length, size).forEach((value, index) => { result[auto[index]!] = value; });
  return result;
}

/** "X right, Y left" as one move: an explicit order puts the named windows first, then the rest as they were. */
export function layoutOrder(openIds: readonly string[], preferred: readonly string[]): string[] {
  const named = preferred.filter((id, index) => openIds.includes(id) && preferred.indexOf(id) === index);
  return [...named, ...openIds.filter((id) => !named.includes(id))];
}
