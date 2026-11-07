import type { WidgetBridge } from '../electron/contract';

declare global {
  interface Window { jarvisWidget?: WidgetBridge }
}
