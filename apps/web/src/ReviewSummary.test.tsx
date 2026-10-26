import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ReviewSummary } from './ReviewSummary';

it('renders server-owned nutrition bullets as a semantic list without interpreting proposal data as HTML', () => {
  const view = render(<ReviewSummary text={'Meal: <img src=x>\nNutrition:\n- Protein: 12.5 g\n- Calories: 300 kcal\n- Fat: unknown (not zero) g\nNothing has changed.'} />);
  expect([...view.container.querySelectorAll('ul > li')].map(item => item.textContent)).toEqual([
    'Protein: 12.5 g', 'Calories: 300 kcal', 'Fat: unknown (not zero) g',
  ]);
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.container.textContent).toContain('Nothing has changed.');
});
