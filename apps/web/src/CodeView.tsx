import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { GeneratedCodeData } from '@jarvis/contracts';

/**
 * The Code view (P9-41, #568): the file Jarvis is reading or searching, shown read-only while it works. Highlighted line
 * ranges are tinted and the first one is scrolled into view each time Jarvis moves; query matches are marked. The
 * content arrives bounded (at most 400 lines) and redacted by the backend; nothing here executes or formats it as HTML.
 */
const repoPattern = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;

function githubUrl({ repo, path, ref, highlight, startLine }: GeneratedCodeData) {
  if (!repoPattern.test(repo)) return null;
  const encodedPath = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const first = highlight?.[0];
  const anchor = first ? `#L${first.from}${first.to > first.from ? `-L${first.to}` : ''}` : startLine && startLine > 1 ? `#L${startLine}` : '';
  return `https://github.com/${repo}/blob/${encodeURIComponent(ref ?? 'HEAD')}/${encodedPath}${anchor}`;
}

function markQuery(line: string, query: string | undefined): ReactNode {
  const needle = query?.trim().toLowerCase();
  if (!needle || needle.length < 2) return line;
  const parts: ReactNode[] = [];
  const lower = line.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(line.slice(from, at));
    parts.push(<mark key={at} className="code-match">{line.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
  }
  if (!parts.length) return line;
  if (from < line.length) parts.push(line.slice(from));
  return parts;
}

export function CodeView({ data, title }: { data: GeneratedCodeData; title: string }) {
  const body = useRef<HTMLDivElement>(null);
  const startLine = data.startLine ?? 1;
  const lines = useMemo(() => data.content.split(/\r\n|\r|\n/u), [data.content]);
  const highlighted = useMemo(() => {
    const set = new Set<number>();
    for (const { from, to } of data.highlight ?? []) for (let line = from; line <= to && set.size < 400; line += 1) set.add(line);
    return set;
  }, [data.highlight]);
  const firstHighlight = data.highlight?.[0]?.from ?? null;
  const link = githubUrl(data);
  const name = data.path.split('/').filter(Boolean).at(-1) ?? data.path;
  const folder = data.path.slice(0, Math.max(0, data.path.length - name.length));

  // Each time Jarvis points somewhere new, bring the first highlighted line to the middle of the view.
  useEffect(() => {
    const container = body.current;
    if (!container) return;
    const target = firstHighlight === null ? null : container.querySelector<HTMLElement>(`[data-line="${firstHighlight}"]`);
    const reduced = document.documentElement.dataset.motion === 'reduced' ||
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    if (target) {
      container.scrollTo?.({ top: Math.max(0, target.offsetTop - container.clientHeight / 2 + target.offsetHeight), behavior: reduced ? 'auto' : 'smooth' });
    } else {
      container.scrollTo?.({ top: 0 });
    }
  }, [data.path, data.content, firstHighlight]);

  return (
    <figure className="code-view" aria-label={title}>
      <figcaption className="code-view-header">
        <span className="code-view-path" title={`${data.repo}/${data.path}`}>
          <span className="code-view-repo">{data.repo}</span>
          <span className="code-view-folder">{folder ? ` / ${folder}` : ' / '}</span>
          <strong>{name}</strong>
        </span>
        {data.ref && <span className="code-view-chip" title="Branch or commit">{data.ref}</span>}
        {data.language && <span className="code-view-chip">{data.language}</span>}
        {link && <a className="code-view-link" href={link} target="_blank" rel="noreferrer">Open on GitHub</a>}
      </figcaption>
      {(data.query || data.highlight?.length) && (
        <p className="visually-hidden">
          {data.highlight?.length ? `Highlighted lines: ${data.highlight.map(({ from, to }) => from === to ? `${from}` : `${from} to ${to}`).join(', ')}. ` : ''}
          {data.query ? `Matches for “${data.query}” are marked.` : ''}
        </p>
      )}
      <div ref={body} className="code-view-body" key={`${data.repo}:${data.path}`} tabIndex={0} aria-label={`Code of ${data.path}`}>
        <pre><code>
          {lines.map((line, index) => {
            const number = startLine + index;
            const lit = highlighted.has(number);
            return (
              <Fragment key={number}>
                <span className="code-line" data-line={number} data-highlighted={lit || undefined}>
                  <span className="code-line-number" aria-hidden="true">{number}</span>
                  <span className="code-line-text">{markQuery(line, data.query) || ' '}</span>
                </span>
                {'\n'}
              </Fragment>
            );
          })}
        </code></pre>
      </div>
    </figure>
  );
}
