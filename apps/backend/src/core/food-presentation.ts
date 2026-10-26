/** Suppress a fallback only when all three exact server values already appear as list items. */
export function includesNutritionList(text: string, presentation: string): boolean {
  // Code examples are not rendered nutrition lists. Prefer the server fallback in that case.
  if (/(?:^|\n)\s*(?:```|~~~)/u.test(text)) return false;
  const normalize = (line: string) => line.replace(/\*\*/gu, '').replace(/\s+/gu, ' ').trim().toLowerCase();
  const expected = presentation.split('\n').filter(line => /^- (Protein|Calories|Fat):/u.test(line))
    .map(line => normalize(line.slice(2)));
  const items = new Set(text.split('\n').filter(line => /^\s*(?:[-*]|\d+[.)])\s+/u.test(line))
    .map(line => normalize(line.replace(/^\s*(?:[-*]|\d+[.)])\s+/u, ''))));
  return expected.length === 3 && expected.every(line => items.has(line));
}
