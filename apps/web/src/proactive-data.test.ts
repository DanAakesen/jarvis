import { describe, expect, it } from 'vitest';
import { isProactiveSettings, isProactiveStatus } from './proactive-data';

describe('PI background web contracts', () => {
  it('accepts the combined 1-12 allowance and independent location source', () => {
    const settings = {
      paused: false,
      monthlyBudgetDkk: 100,
      backgroundTurnsPerDay: 4,
      sources: [
        'todos', 'calendar', 'mail', 'weather', 'factory', 'news', 'travel', 'x',
        'health', 'nutrition', 'notes', 'memory', 'location',
      ].map((id) => ({ id, enabled: id === 'location' })),
      categories: ['deadline', 'clash', 'travel', 'todo', 'prep', 'news', 'weather', 'status', 'suggestion']
        .map((id) => ({ id, enabled: true })),
      suggestionScope: 'all',
      newsFeeds: [],
      guidance: '',
      revision: 'a'.repeat(64),
      preferences: [],
      capabilities: { title: 'Examples', examples: [] },
    };
    expect(isProactiveSettings(settings)).toBe(true);
    expect(isProactiveSettings({ ...settings, backgroundTurnsPerDay: 13 })).toBe(false);
  });

  it('accepts content-free background status, freshness and queue recovery', () => {
    const background = {
      available: true, enabled: false, updatedAt: null, paused: false,
      budget: { limitDkk: 100, spentDkk: 0.34, state: 'ok' },
      month: { wakes: 2, costDkk: 0.34 },
      today: { messages: 0, usedTurns: 2, allowedTurns: 4 },
      lastWake: null, logPending: 0,
      slots: {
        used: 2, allowed: 4, remaining: 2, lastAt: '2026-11-19T05:00:00Z',
        nextAllowedAt: null, quiet: false, queue: { pending: 1, leased: 0, retrying: 1 },
      },
      situation: {
        revision: 3, asOf: '2026-11-19T04:58:00Z', updatedAt: '2026-11-19T05:00:00Z',
        staleSources: [], missingSources: ['mail'], disabledSources: ['weather'],
      },
      cost: {
        coldSweepMinDkk: 0.14, coldSweepMaxDkk: 0.28, representativeToolTurnDkk: 0.17,
        preflightWorstCaseDkk: 0.79, estimatedDayMinDkk: 0.56, estimatedDayMaxDkk: 1.12,
        estimatedThirtyDayMinDkk: 16.8, estimatedThirtyDayMaxDkk: 33.6,
      },
    };
    expect(isProactiveStatus({
      paused: false, quietNow: false, nextSlotAt: '2026-11-19T07:00:00Z',
      lastRun: null,
      budget: { month: '2026-11', monthlyLimitDkk: 100, estimatedSpendDkk: 0.34, state: 'ok' },
      sources: [{ id: 'location', enabled: true, state: 'ok', reason: null, observedAt: '2026-11-19T05:00:00Z' }],
      background,
    })).toBe(true);
  });
});
