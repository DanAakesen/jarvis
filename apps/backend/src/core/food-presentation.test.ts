import { expect, it } from 'vitest';
import { includesNutritionList } from './food-presentation.js';
const presentation = 'Estimate:\n- Protein: 10 g\n- Calories: 200 kcal\n- Fat: unknown (not zero) g';
it('recognizes reordered formatted list items, preserving missing and changed values', () => {
  expect(includesNutritionList('1. **Calories:** 200 kcal\n2. **Protein:** 10 g\n3. Fat: unknown (not zero) g', presentation)).toBe(true);
  expect(includesNutritionList('Protein: 10 g; Calories: 200 kcal; Fat: unknown (not zero) g', presentation)).toBe(false);
  expect(includesNutritionList(presentation.replace('10 g', '12 g'), presentation)).toBe(false);
  expect(includesNutritionList(`\`\`\`\n${presentation}\n\`\`\``, presentation)).toBe(false);
  expect(includesNutritionList(presentation.replace('unknown (not zero)', '0'), presentation)).toBe(false);
  expect(includesNutritionList('- Protein: 10 g\n- Calories: 200 kcal', presentation)).toBe(false);
});
