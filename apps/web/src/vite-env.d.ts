import type { PublicConfig } from '../config/public-config';

declare global {
  const __JARVIS_CONFIG__: PublicConfig;
}
