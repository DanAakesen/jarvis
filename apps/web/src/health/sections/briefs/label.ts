import type { Row } from '../nutrition/totals';
import { readable } from '../../presentation';

/** The brief read model returns a trigger and timestamps, never a title, so the label comes from the stored trigger. */
export function briefLabel(item: Row): string {
  const trigger = typeof item.trigger === 'string' ? item.trigger.trim() : '';
  return trigger ? `${readable(trigger)} brief` : 'Brief';
}
