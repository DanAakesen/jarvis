import { describe, expect, it } from 'vitest';
import { exactLabelIntent, favoriteIntent } from './intent.js';

function refusal(run: () => unknown): string {
  try { run(); } catch (error) { return (error as Error).message; }
  throw new Error('Expected a refusal');
}

describe('food intent', () => {
  it('still accepts exactly the rigid label command', () => {
    expect(exactLabelIntent('Log banana: 105 kcal, protein 1 g')).toMatchObject({ mealName: 'banana', energyKcal: 105, proteinGrams: 1 });
    expect(exactLabelIntent('Can you please log "Greek yoghurt": 200 kcal, protein 10 g.')).toMatchObject({ mealName: 'Greek yoghurt', energyKcal: 200 });
    expect(favoriteIntent('Log my favourite oatmeal')).toBe('oatmeal');
  });

  it('says which messages health_food logs and where a described meal goes', () => {
    const text = refusal(() => exactLabelIntent('Hey Jarvis, log banana: 105 kcal'));
    expect(text).toContain('starts with log');
    expect(text).toContain('health_food_review');
    expect(text).toContain('no intake was logged');
    expect(refusal(() => favoriteIntent('I just had two eggs'))).toContain('health_food_review');
  });

  it('tells Dan to write a decimal with a dot', () => {
    const text = refusal(() => exactLabelIntent('Log banana: 105 kcal, protein 1,3 g'));
    expect(text).toContain('with a dot');
    expect(text).toContain('no intake was logged');
  });

  it('sends an approximate amount to the review path', () => {
    const text = refusal(() => exactLabelIntent('Log banana: about 105 kcal'));
    expect(text).toContain('exact label');
    expect(text).toContain('health_food_review');
  });

  it('shows the label format, including quotes for a name of several words', () => {
    const text = refusal(() => exactLabelIntent('Log greek yoghurt 200 kcal'));
    expect(text).toContain('"Log yoghurt: 200 kcal, protein 10 g"');
    expect(text).toContain('quotes');
    expect(text).toContain('health_food_review');
  });
});
