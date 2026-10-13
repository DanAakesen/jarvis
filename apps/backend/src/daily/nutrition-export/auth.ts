import type { FastifyRequest } from 'fastify';
import { AuthenticationDenied } from '../../auth/verify.js';
import { instant, text } from '../nutrition/model.js';

export interface NutritionExportDevice {
  kind: 'nutrition-export-device'; ownerObjectId: string; deviceId: string;
  scope: 'nutrition-export'; expiresAt: string; revoked: boolean;
}
/** Trusted server capability: verify signature/hash, expiry and current revocation on EVERY call.
 * No implementation/provisioning/credential store is installed by this inactive slice. */
export type NutritionExportCredentialVerifier = (credential: string, signal: AbortSignal) => Promise<NutritionExportDevice | null>;
declare module 'fastify' {
  interface FastifyRequest { nutritionExportPrincipal: NutritionExportDevice | null }
  interface FastifyContextConfig { jarvisNutritionExport?: boolean }
}
export const exportDevicePaths = new Set(['/daily/nutrition/export/claim','/daily/nutrition/export/complete']);
export async function verifyExportCredential(verify: NutritionExportCredentialVerifier,credential: string): Promise<NutritionExportDevice | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([verify(credential,controller.signal),new Promise<never>((_resolve,reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new AuthenticationDenied(403)); },5000);
    })]);
  } finally { if (timer) clearTimeout(timer); controller.abort(); }
}
export function validateExportDevice(device: NutritionExportDevice | null, owner: string | undefined, now = Date.now()): NutritionExportDevice {
  try {
    if (!device || device.kind !== 'nutrition-export-device' || device.scope !== 'nutrition-export' || device.revoked !== false || !owner ||
        device.ownerObjectId.toLowerCase() !== owner.toLowerCase()) throw new Error('Denied');
    text(device.deviceId,256); instant(device.expiresAt);
    if (Date.parse(device.expiresAt) <= now) throw new Error('Expired');
    return { ...device,ownerObjectId: owner };
  } catch { throw new AuthenticationDenied(403); }
}
export function resolveExportDevice(request: FastifyRequest): NutritionExportDevice {
  if (request.principal || request.agentPrincipal || request.runnerPrincipal || request.pcBridgePrincipal || request.phoneEventGridPrincipal || request.deployPrincipal) throw new AuthenticationDenied(403);
  return validateExportDevice(request.nutritionExportPrincipal,request.server.ownerObjectId);
}
