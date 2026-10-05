import type { JarvisActivityEvent } from '@jarvis/contracts';
import type { EventHub } from './event-hub.js';

export type JarvisActivityHub = EventHub<JarvisActivityEvent>;
