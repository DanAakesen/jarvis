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
  const blocks: { start: number; end: number }[] = [];
  for (const [index, line] of lines.entries()) {
    if (/^\s*(?:```|~~~)/u.test(line)) fenced = !fenced;
    const nutrient = !fenced && /^\s*(?:[-*]|\d+[.)])\s+(?:Protein|Calories|Fat|Carbohydrates|Fiber):/iu.test(line.replace(/\*\*/gu, ''));
    if (nutrient) {
      const previous = blocks.at(-1);
      if (previous?.end === index) previous.end = index + 1;
      else blocks.push({ start: index, end: index + 1 });
    }
  }
  const selected = blocks.find(block => includesNutritionList(lines.slice(block.start, block.end).join('\n'), presentation));
  if (!selected) return `${text}\n\n${presentation}`;
  return [...lines.slice(0, selected.start), ...canonical, ...lines.slice(selected.end)].join('\n');
}
