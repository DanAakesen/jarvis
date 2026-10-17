import type { PublicConfig } from '../config/public-config';

declare global {
  const __JARVIS_CONFIG__: PublicConfig;
  /** Build-time Daily switch (VITE_DAILY_ENABLED); false unless the build explicitly sets it to true. */
  const __JARVIS_DAILY_ENABLED__: boolean;
}
