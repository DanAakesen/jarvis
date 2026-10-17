import type { WindowRect } from './window-layout';

export const conversationLayoutKey = 'jarvis.conversation-layout.v1';
export const phoneConversationLayoutKey = 'jarvis.conversation-layout.phone.v1';
export type ConversationPosition = { left: number; top: number; width: number };
export type ConversationCanvasSize = { width: number; height: number };
export type ConversationResizeEdge = 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export function readConversationLayout(key = conversationLayoutKey): { layout: WindowRect | null; size?: ConversationCanvasSize; error: string } {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return { layout: null, error: '' };
    const layout: unknown = JSON.parse(value);
    if (typeof layout !== 'object' || layout === null ||
      !('x' in layout) || !('y' in layout) || !('width' in layout) || !('height' in layout) ||
      ![layout.x, layout.y, layout.width, layout.height].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) ||
      typeof layout.width !== 'number' || typeof layout.height !== 'number' ||
      typeof layout.x !== 'number' || typeof layout.y !== 'number' ||
      layout.width === 0 || layout.height === 0 || layout.x + layout.width > 1.001 || layout.y + layout.height > 1.001) {
      throw new Error('Invalid conversation layout');
    }
    const size = 'size' in layout ? layout.size : undefined;
    if (size !== undefined && (typeof size !== 'object' || size === null || !('width' in size) || !('height' in size) ||
      typeof size.width !== 'number' || typeof size.height !== 'number' ||
      ![size.width, size.height].every(v => Number.isFinite(v) && v > 0 && v <= 16384))) {
      throw new Error('Invalid conversation canvas size');
    }
    return {
      layout: { x: layout.x, y: layout.y, width: layout.width, height: layout.height },
      ...(size && 'width' in size && 'height' in size && typeof size.width === 'number' && typeof size.height === 'number'
        ? { size: { width: size.width, height: size.height } } : {}),
      error: '',
    };
  } catch {
    return { layout: null, error: 'Saved chat layout could not be read. Move or resize the chat to save a new layout.' };
  }
}

export function saveConversationLayout(layout: WindowRect, size?: ConversationCanvasSize, key = conversationLayoutKey): string {
  try {
    localStorage.setItem(key, JSON.stringify({ ...layout, ...(size ? { size } : {}) }));
    return '';
  } catch {
    return 'Chat layout could not be saved on this device. Your changes will last until you refresh.';
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function fitConversationLayout(rect: WindowRect, size: ConversationCanvasSize, referenceSize?: ConversationCanvasSize): WindowRect {
  const scaleX = referenceSize ? referenceSize.width / Math.max(1, size.width) : 1;
  const scaleY = referenceSize ? referenceSize.height / Math.max(1, size.height) : 1;
  const width = clamp(rect.width * scaleX, Math.min(320, size.width) / Math.max(1, size.width), 1);
  const height = clamp(rect.height * scaleY, Math.min(160, size.height) / Math.max(1, size.height), 1);
  return { width, height, x: clamp(rect.x * scaleX, 0, 1 - width), y: clamp(rect.y * scaleY, 0, 1 - height) };
}

export function resizeConversationLayout(rect: WindowRect, dx: number, dy: number, edge: ConversationResizeEdge,
  size: { width: number; height: number }): WindowRect {
  const left = edge.endsWith('left');
  const top = edge.startsWith('top');
  const minWidth = Math.min(320, size.width) / size.width;
  const minHeight = Math.min(160, size.height) / size.height;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const width = edge === 'top' || edge === 'bottom' ? rect.width : clamp(rect.width + (left ? -dx : dx), minWidth, left ? right : 1 - rect.x);
  const height = edge === 'left' || edge === 'right' ? rect.height : clamp(rect.height + (top ? -dy : dy), minHeight, top ? bottom : 1 - rect.y);
  return { x: left ? right - width : rect.x, y: top ? bottom - height : rect.y, width, height };
}
