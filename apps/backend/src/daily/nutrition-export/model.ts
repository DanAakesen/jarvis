import { canonicalJson, instant, nutrients, text } from '../nutrition/model.js';

export const queueRetentionMs = 7 * 86400_000;
export const claimLeaseMs = 5 * 60_000;
export class ExportConflict extends Error { constructor() { super('Export state conflicts. Reconcile before retrying.'); } }
export class ExportUnavailable extends Error { constructor() { super('Export unavailable. No native write or successful export is claimed.'); } }
export interface ExportPeriod { from: string; to: string }
/** Trusted existing user-intent/confirmation metadata, never deserialized from model/client JSON. */
export interface PeriodAuthority { intent: 'queue-nutrition-export'; explicit: boolean; confirmedPeriod: ExportPeriod }
export interface ClaimInput { operationKey: string; limit?: number }
export interface Completion { id: string; claimToken: string; status: 'written' | 'failed'; writer?: string; error?: string }
export interface ExportItem {
  id: string; idempotencyKey: string; mealName: string; mealType: string | null; components: unknown[];
  occurredAt: string; nutrients: { caloriesKcal: number; proteinGrams: number | null; carbohydratesGrams: number | null; fatGrams: number | null; fiberGrams: number | null };
  confidence: string; captureMethod: string; status: string; createdAt: string;
}
export function period(input: ExportPeriod): ExportPeriod {
  if (!input || Object.keys(input).some((key) => !['from','to'].includes(key))) throw new TypeError('Invalid export period');
  instant(input.from); instant(input.to);
  const duration = Date.parse(input.to) - Date.parse(input.from);
  if (duration <= 0 || duration > 62 * 86400_000) throw new TypeError('Export period exceeds limits');
  return { from: new Date(input.from).toISOString(),to: new Date(input.to).toISOString() };
}
export function authorizePeriod(input: ExportPeriod, authority: PeriodAuthority): ExportPeriod {
  const normalized = period(input);
  if (authority?.intent !== 'queue-nutrition-export' || authority.explicit !== true || canonicalJson(period(authority.confirmedPeriod)) !== canonicalJson(normalized)) throw new ExportConflict();
  return normalized;
}
export function claimInput(input: ClaimInput): Required<ClaimInput> {
  if (!input || Object.keys(input).some((key) => !['operationKey','limit'].includes(key))) throw new TypeError('Invalid claim');
  text(input.operationKey); const limit = input.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new TypeError('Invalid claim limit');
  return { operationKey: input.operationKey,limit };
}
export function completion(input: Completion): { id: string; claimToken: string; receipt: string; writer: string; error: string | null; status: 'written' | 'failed' } {
  if (!input || Object.keys(input).some((key) => !['id','claimToken','status','writer','error'].includes(key))) throw new TypeError('Invalid completion');
  text(input.id);
  if (typeof input.claimToken !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(input.claimToken) || !['written','failed'].includes(input.status)) throw new TypeError('Invalid completion');
  const writer = input.writer ?? 'Apple Shortcuts'; text(writer,100);
  if (input.error !== undefined) text(input.error,500);
  if (input.status === 'written' && input.error !== undefined) throw new TypeError('Written receipt cannot contain an error');
  const error = input.error ?? null;
  return { id: input.id,claimToken: input.claimToken.toLowerCase(),writer,error,status: input.status,
    receipt: canonicalJson({ status: input.status,writer,error }) };
}
export function exportItem(row: Record<string,unknown>): ExportItem {
  const components: unknown = JSON.parse(row.components_json as string);
  if (!Array.isArray(components)) throw new ExportUnavailable();
  const values = { energyKcal: row.energy_kcal as number,proteinGrams: row.protein_grams as number | null,
    carbohydratesGrams: row.carbohydrates_grams as number | null,fatGrams: row.fat_grams as number | null,fiberGrams: row.fiber_grams as number | null };
  nutrients(values); instant(row.occurred_at); instant(row.created_at);
  text(row.id); text(row.idempotency_key); text(row.meal_name,2000);
  if (row.meal_type !== null) text(row.meal_type,256);
  text(row.confidence,256); text(row.capture_method,256); text(row.status,256);
  const item: ExportItem = { id: row.id,idempotencyKey: row.idempotency_key,mealName: row.meal_name,mealType: row.meal_type as string | null,
    components,occurredAt: row.occurred_at,nutrients: { caloriesKcal: values.energyKcal,proteinGrams: values.proteinGrams,
      carbohydratesGrams: values.carbohydratesGrams,fatGrams: values.fatGrams,fiberGrams: values.fiberGrams },
    confidence: row.confidence,captureMethod: row.capture_method,status: row.status,createdAt: row.created_at };
  if (Buffer.byteLength(canonicalJson(item),'utf8') > 64 * 1024) throw new ExportUnavailable();
  return item;
}
