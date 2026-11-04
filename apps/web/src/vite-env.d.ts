import type { PublicConfig } from '../config/public-config';

declare global {
  const __JARVIS_CONFIG__: PublicConfig;
  /** Build-time Health switch (VITE_HEALTH_ENABLED); false unless the build explicitly sets it to true. */
  const __JARVIS_HEALTH_ENABLED__: boolean;
  const __JARVIS_PUSH_ENABLED__: boolean;
  const __JARVIS_PROACTIVE_ENABLED__: boolean;
}
