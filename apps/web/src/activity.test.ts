import { describe, expect, it } from 'vitest';
import { activityHref } from './activity';

describe('activityHref', () => {
  it('keeps the Software Factory links', () => {
    expect(activityHref('task:42')).toBe('/factory/tasks/42');
    expect(activityHref('release:7')).toBe('/factory/releases/7');
  });

  it('opens a proactive finding from its Now card', () => {
    expect(activityHref('proactive:0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d')).toBe('/proactive/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d');
  });

  it('gives anything unexpected no link', () => {
    expect(activityHref('proactive:../settings')).toBeNull();
    expect(activityHref('proactive:42')).toBeNull();
    expect(activityHref('javascript:alert(1)')).toBeNull();
    expect(activityHref(null)).toBeNull();
  });
});
