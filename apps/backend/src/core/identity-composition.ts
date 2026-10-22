import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Settings } from './settings.js';
import type { AwayModeState } from './away-mode.js';

interface IdentityContract {
  version: number;
  precedence: string[];
  fixedKernel: Record<'da' | 'en', string>;
  productIdentity: Record<'da' | 'en', string>;
  ownerIdentityLabel: Record<'da' | 'en', string>;
}

export const identityContract = JSON.parse(readFileSync(
  new URL('../../../../agents/jarvis/identity-contract.json', import.meta.url),
  'utf8',
)) as IdentityContract;

export function composeIdentityInstructions(identity: Settings['identity'], language: 'da' | 'en'): string {
  return [
    `Identity composition contract v${identityContract.version}. Precedence: ${identityContract.precedence.join(' > ')}.`,
    `Fixed truthfulness and security kernel:\n${identityContract.fixedKernel[language]}`,
    `Shared Jarvis product identity:\n${identityContract.productIdentity[language]}`,
    `${identityContract.ownerIdentityLabel[language]}\n${JSON.stringify(identity.description)}`,
  ].join('\n\n');
}

export function identityCompositionRevision(
  identity: Settings['identity'],
  personality: Settings['personality'],
  presence: AwayModeState,
): string {
  return createHash('sha256').update(JSON.stringify({
    contractVersion: identityContract.version,
    identity,
    personality,
    mode: presence.mode,
    changedAt: presence.changedAt,
  })).digest('hex');
}
