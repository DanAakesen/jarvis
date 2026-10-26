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

/** Keep one canonical nutrition list while preserving surrounding meal/uncertainty text. */
export function presentNutritionList(text: string, presentation: string): string {
  const canonical = presentation.split('\n').filter(line => /^- (Protein|Calories|Fat|Carbohydrates|Fiber):/u.test(line));
  if (!canonical.length) return text;
  const lines = text.split('\n');
  let fenced = false;
  let inserted = false;
  const result: string[] = [];
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/u.test(line)) fenced = !fenced;
    const plain = line.replace(/\*\*/gu, '');
    if (!fenced && /^\s*(?:[-*]|\d+[.)])\s+(?:Protein|Calories|Fat|Carbohydrates|Fiber):/iu.test(plain)) {
      if (!inserted) { result.push(...canonical); inserted = true; }
    } else result.push(line);
  }
  return inserted ? result.join('\n') : `${text}\n\n${presentation}`;
}
