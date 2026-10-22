import { describe, expect, it } from 'vitest';
import { defaultProactiveSettings } from './store.js';
import { classifySuggestionScope, findingAllowed, hasTravelEvidence } from './policy.js';

describe('proactive preference policy', () => {
  it('requires the finding category and every related category to be enabled', () => {
    const settings = defaultProactiveSettings();
    settings.categories.travel = false;

    expect(findingAllowed(settings, 'travel', 'personal')).toBe(false);
    expect(findingAllowed(settings, 'prep', 'personal', ['travel'])).toBe(false);
    expect(findingAllowed(settings, 'prep', 'personal')).toBe(true);
  });

  it('requires an exact personal or work scope and conservatively excludes unknown and mixed evidence', () => {
    expect(classifySuggestionScope('Family appointment', [{ text: 'Family appointment' }])).toBe('personal');
    expect(classifySuggestionScope('Lægeaftale for familien', [{ text: 'Lægeaftale for familien' }])).toBe('personal');
    expect(classifySuggestionScope('Client agenda', [{ text: 'Client agenda' }])).toBe('work');
    expect(classifySuggestionScope('Møde med en kollega', [{ text: 'Møde med en kollega' }])).toBe('work');
    expect(classifySuggestionScope('Meeting notes', [{ text: 'Meeting notes' }])).toBe('unknown');
    expect(classifySuggestionScope('Family appointment', [
      { taskScope: 'personal', text: 'Family appointment' },
      { taskScope: 'work', text: 'Client agenda' },
    ])).toBe('unknown');
    expect(classifySuggestionScope('Family work trip', [{ taskScope: 'personal', text: 'Family work trip' }]))
      .toBe('unknown');
  });

  it('detects travel in evidence from any source, not only the travel source', () => {
    expect(hasTravelEvidence('Prepare itinerary', [{ text: 'Hotel reservation from a mail message' }])).toBe(true);
    expect(hasTravelEvidence('Review agenda', [{ text: 'Prepare the office' }])).toBe(false);
  });
});
