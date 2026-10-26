export function ReviewSummary({ text }: { text: string }) {
  const groups = text.split('\n');
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const line of groups) {
    const list = line.startsWith('- ');
    const previous = blocks.at(-1);
    if (previous?.list === list) previous.lines.push(line);
    else blocks.push({ list, lines: [line] });
  }
  return <div className="confirmation-summary">{blocks.map((block, index) => block.list
    ? <ul key={index}>{block.lines.map((line, item) => <li key={item}>{line.slice(2)}</li>)}</ul>
    : <p key={index}>{block.lines.join('\n')}</p>)}</div>;
}
