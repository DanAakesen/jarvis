const danishWords = new Set('og at en et er det der som på til af i for med ikke jeg du vi de den har kan skal'.split(' '));
const englishWords = new Set('the and to of a in is that it for on with not i you we they this are have can will'.split(' '));

export function detectLanguage(messages: string[]): 'da' | 'en' {
  let danish = 0;
  let english = 0;
  for (const message of messages.slice(-8)) {
    const normalized = message.toLocaleLowerCase('da');
    for (const word of normalized.match(/[\p{L}]+/gu) ?? []) {
      if (danishWords.has(word)) danish++;
      if (englishWords.has(word)) english++;
    }
    for (const character of normalized) {
      if ('æøå'.includes(character)) danish++;
    }
  }
  return danish > english ? 'da' : 'en';
}
