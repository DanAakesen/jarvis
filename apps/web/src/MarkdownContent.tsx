import ReactMarkdown, { type Components } from 'react-markdown';

const allowedProtocols = new Set(['http:', 'https:', 'mailto:']);

function safeUrl(value: string): string {
  try {
    return allowedProtocols.has(new URL(value).protocol.toLowerCase()) ? value : '';
  } catch {
    return '';
  }
}

function hasOpenBold(source: string): boolean {
  let open = false;
  let inlineCodeLength = 0;
  let fence: { character: string; length: number } | null = null;

  for (const line of source.split('\n')) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
    if (fence) {
      const closingFence = /^ {0,3}(`+|~+)[ \t]*$/u.exec(line)?.[1];
      if (closingFence?.[0] === fence.character && closingFence.length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = { character: fenceMatch[1]![0]!, length: fenceMatch[1]!.length };
      continue;
    }

    for (let index = 0; index < line.length; index += 1) {
      if (line[index] === '\\') {
        index += 1;
      } else if (line[index] === '`') {
        let end = index + 1;
        while (line[end] === '`') end += 1;
        const delimiterLength = end - index;
        if (inlineCodeLength === 0) inlineCodeLength = delimiterLength;
        else if (inlineCodeLength === delimiterLength) inlineCodeLength = 0;
        index = end - 1;
      } else if (inlineCodeLength === 0 && line.startsWith('**', index)) {
        open = !open;
        index += 1;
      }
    }
  }

  return open;
}

function completeStreamingBold(source: string): string {
  return hasOpenBold(source) ? `${source}**` : source;
}

const components: Components = {
  a: ({ href, children }) => href
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    : <>{children}</>,
  img: ({ alt }) => alt ? <span>{alt}</span> : null,
};

export function MarkdownContent({ source, streaming = false }: { source: string; streaming?: boolean }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        skipHtml
        urlTransform={safeUrl}
        components={components}
      >
        {streaming ? completeStreamingBold(source) : source}
      </ReactMarkdown>
    </div>
  );
}
