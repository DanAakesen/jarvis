import type { PublicConfig } from '../config/public-config';

declare global {
  const __JARVIS_CONFIG__: PublicConfig;
  const __JARVIS_PUSH_ENABLED__: boolean;
}
