import { describe, expect, it } from 'vitest';
import { briefLabel } from './label';

describe('briefLabel', () => {
  it('names a brief from the stored trigger the API returns', () => {
    expect(briefLabel({ id: 'a', trigger: 'scheduled' })).toBe('Scheduled brief');
    expect(briefLabel({ id: 'a', trigger: ' manual_refresh ' })).toBe('Manual refresh brief');
  });

  it('falls back to a neutral label when the trigger is missing or not text', () => {
    expect(briefLabel({ id: 'a' })).toBe('Brief');
    expect(briefLabel({ id: 'a', trigger: '   ' })).toBe('Brief');
    expect(briefLabel({ id: 'a', trigger: 7 })).toBe('Brief');
  });

  it('does not depend on a title or kind that the API never supplies', () => {
    expect(briefLabel({ id: 'a', title: 'Invented', kind: 'daily', trigger: 'manual' })).toBe('Manual brief');
  });
});
