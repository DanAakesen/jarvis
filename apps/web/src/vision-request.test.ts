import { describe, expect, it } from 'vitest';
import { isCameraRequest, isScreenRequest } from './vision-request';

describe('explicit vision requests', () => {
  it.each(['What am I holding?', "What's in my hand?", 'Look at my camera', 'What can you see?',
    'Can you see me?', 'Can you see this?', 'can you see anything?', 'Do you see anything?',
    'Tell me what you see', 'What do you see?', 'Hvad holder jeg?', 'Kig på mit kamera', 'Hvad kan du se?',
    'Kan du se mig?', 'Kan du se noget?', 'Hvad ser du?'])(
    'recognises a camera request shared by chat and voice: %s', (text) => {
      expect(isCameraRequest(text)).toBe(true);
    },
  );
  it.each(['Look at my screen', "What's on the screen?", 'Can you see anything on my screen?',
    'What do you see on the screen?', 'Tell me what you see on my screen', 'Kig på min skærm', 'Hvad kan du se på min skærm?',
    'Kan du se noget på min skærm?'])(
    'recognises a screen request: %s', (text) => { expect(isScreenRequest(text)).toBe(true); },
  );
  it.each(['The camera is on', 'How is the weather?', 'Turn camera off'])(
    'does not treat unrelated text or a control command as an explicit camera request: %s', (text) => {
      expect(isCameraRequest(text)).toBe(false);
    },
  );
});
