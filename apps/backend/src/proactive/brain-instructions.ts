import { readFileSync } from 'node:fs';

const document = new URL('../../../../agents/pi/skills/jarvis-brain/SKILL.md', import.meta.url);
export const defaultBrainInstructions = readFileSync(document, 'utf8').replace(/\r\n/gu, '\n').replace(/^---\n[\s\S]*?\n---\n/u, '').trim();
export const maxBrainInstructionLength = 16_000;
