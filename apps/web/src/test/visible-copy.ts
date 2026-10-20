import { expect } from 'vitest';

const forbiddenWord = /\bdaily\b/iu;
const visibleAttributes = ['aria-label', 'title', 'alt', 'placeholder'] as const;

export function expectNoDailyInRenderedContent(root: HTMLElement) {
  const violations: string[] = [];
  const text = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (text.nextNode()) {
    const value = text.currentNode.textContent ?? '';
    if (forbiddenWord.test(value)) violations.push(`text: ${value}`);
  }

  const selector = visibleAttributes.map(attribute => `[${attribute}]`).join(',');
  for (const element of [root, ...root.querySelectorAll<HTMLElement>(selector)]) {
    for (const attribute of visibleAttributes) {
      const value = element.getAttribute(attribute);
      if (value && forbiddenWord.test(value)) violations.push(`${attribute}: ${value}`);
    }
  }

  expect(violations).toEqual([]);
}
