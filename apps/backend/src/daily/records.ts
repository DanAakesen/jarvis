import { createHash } from 'node:crypto';
import type { DailyJson } from '@jarvis/contracts';
import { ToolFailure } from '../core/tool-registry.js';
import { canonicalJson } from './nutrition/model.js';

const mealFields = ['id', 'idempotency_key', 'meal_name', 'meal_type', 'occurred_at', 'meal_date',
  'energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams', 'confidence',
  'capture_method', 'source', 'revision', 'deleted_at', 'created_at', 'updated_at',
  'components_json', 'nutrient_provenance_json'] as const;
const favoriteFields = ['id', 'favorite_name', 'normalized_name', 'aliases_json', 'meal_name', 'meal_type',
  'components_json', 'energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams',
  'confidence', 'nutrient_provenance_json', 'source_meal_id', 'source_idempotency_key', 'revision', 'created_at', 'updated_at'] as const;
const planFields = ['id', 'plan_name', 'normalized_name', 'description', 'items_json', 'energy_kcal',
  'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams', 'revision', 'deleted_at', 'created_at', 'updated_at'] as const;
const jsonFields = new Set(['components_json', 'nutrient_provenance_json', 'aliases_json', 'items_json']);

export function dailyJson(value: unknown): DailyJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(dailyJson);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, dailyJson(item)]));
  throw new ToolFailure('Daily data could not be represented safely.');
}

export function projectDailyRecord(row: Record<string, unknown>, fields: readonly string[]): Record<string, DailyJson> {
  return Object.fromEntries(fields.filter(field => Object.hasOwn(row, field)).map(field => {
    const value: unknown = jsonFields.has(field) && typeof row[field] === 'string' ? JSON.parse(row[field]) : row[field];
    return [field, value instanceof Date && field.endsWith('_date') ? value.toISOString().slice(0, 10) : dailyJson(value)];
  }));
}

export function projectNutritionRecord(row: Record<string, unknown>, source: 'favorite' | 'history' | 'plan'): Record<string, DailyJson> {
  return projectDailyRecord(row, source === 'favorite' ? favoriteFields : source === 'plan' ? planFields : mealFields);
}

export function favoriteFingerprint(row: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(projectNutritionRecord(row, 'favorite'))).digest('hex');
}
