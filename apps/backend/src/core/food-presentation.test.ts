import { expect, it } from 'vitest';
import { includesNutritionList, presentNutritionList } from './food-presentation.js';
const presentation = 'Estimate:\n- Protein: 10 g\n- Calories: 200 kcal\n- Fat: unknown (not zero) g';
it('recognizes reordered formatted list items, preserving missing and changed values', () => {
  expect(includesNutritionList('1. **Calories:** 200 kcal\n2. **Protein:** 10 g\n3. Fat: unknown (not zero) g', presentation)).toBe(true);
  expect(includesNutritionList('Protein: 10 g; Calories: 200 kcal; Fat: unknown (not zero) g', presentation)).toBe(false);
  expect(includesNutritionList(presentation.replace('10 g', '12 g'), presentation)).toBe(false);
  expect(includesNutritionList(`\`\`\`\n${presentation}\n\`\`\``, presentation)).toBe(false);
  expect(includesNutritionList(presentation.replace('unknown (not zero)', '0'), presentation)).toBe(false);
  expect(includesNutritionList('- Protein: 10 g\n- Calories: 200 kcal', presentation)).toBe(false);
});

it('keeps one rounded list with every nutrient and preserves source precision', async () => {
  const { nutritionSummary } = await import('../daily/nutrition/review.js');
  const values = { proteinGrams: 36.7645, energyKcal: 632.0129381733168, fatGrams: 18.510714285714286,
    carbohydratesGrams: 74.08109593194055, fiberGrams: 11.017062937062937 };
  const before = structuredClone(values);
  const summary = nutritionSummary(values);
  expect(summary).toBe('- Protein: 37 g\n- Calories: 632 kcal\n- Fat: 19 g\n- Carbohydrates: 74 g\n- Fiber: 11 g');
  const shown = presentNutritionList('Estimated meal\n- Protein: 37 g\n- Calories: 632 kcal\n- Fat: 19 g\nPortions are estimated.', summary);
  expect(shown.match(/Protein:/gu)).toHaveLength(1);
  expect(shown).toContain('- Carbohydrates: 74 g\n- Fiber: 11 g');
  expect(shown).toContain('Portions are estimated.');
  expect(presentNutritionList('Checked it.', summary)).toBe(`Checked it.\n\n${summary}`);
  expect(values).toEqual(before);
  expect(nutritionSummary({ ...values, proteinGrams: null, fatGrams: 0 })).toContain('- Protein: unknown (not zero) g\n- Calories: 632 kcal\n- Fat: 0 g');
});
