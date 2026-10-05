import { createContext } from 'react';

export const PlaybackAudioLevelContext = createContext<(level: number) => void>(() => {});
