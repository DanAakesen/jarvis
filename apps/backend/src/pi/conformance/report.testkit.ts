import type { CallableStatus } from './callable.testkit.js';

export interface ToolRow {
  readonly name: string;
  readonly group: string;
  readonly visibility: 'chat' | 'activation' | 'wake' | 'legacy';
  readonly effect: string;
  readonly staticProblems: readonly string[];
  readonly discover: { readonly phrase: string; readonly language: string; readonly rank: number; readonly source: 'curated' | 'derived' } | undefined;
  readonly callable: CallableStatus | undefined;
  readonly schemaTokens: number;
  /** What `find_tools` gives the model: a very large schema is compacted (pi/compact-schema.ts), so this can be far below `schemaTokens`. */
  readonly sentTokens: number;
  readonly definitionTokens: number;
  readonly notes: readonly string[];
}

const visibilityLabel: Record<ToolRow['visibility'], string> = {
  chat: 'chat and voice', activation: 'activation turn', wake: 'background wake', legacy: 'HTTP only (legacy)',
};

const cell = (value: string) => value.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|').replace(/\s+/gu, ' ').trim();
const clip = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);

function callableCell(status: CallableStatus | undefined): string {
  if (!status) return 'not run';
  switch (status.kind) {
    case 'ok': return status.variants > 1 ? `ok (${status.variants} calls${status.typed > 0 ? `, ${status.typed} typed refusals or failures proven` : ''})` : 'ok';
    case 'refusal': return 'refusal';
    case 'failure': return 'failure (typed)';
    case 'requiresExternal': return 'requiresExternal';
    case 'legacy': return 'not advertised';
    case 'skipped': return 'skipped';
  }
}

export function summarize(rows: readonly ToolRow[]) {
  const count = (test: (row: ToolRow) => boolean) => rows.filter(test).length;
  return {
    total: rows.length,
    visibility: {
      chat: count((row) => row.visibility === 'chat'), activation: count((row) => row.visibility === 'activation'),
      wake: count((row) => row.visibility === 'wake'), legacy: count((row) => row.visibility === 'legacy'),
    },
    staticOk: count((row) => row.staticProblems.length === 0),
    discoverTop3: count((row) => row.discover !== undefined && row.discover.rank <= 3),
    discoverListed: count((row) => row.discover !== undefined && row.discover.rank > 3),
    discoverNone: count((row) => row.discover === undefined && row.visibility !== 'legacy'),
    callable: {
      ok: count((row) => row.callable?.kind === 'ok'), refusal: count((row) => row.callable?.kind === 'refusal'),
      failure: count((row) => row.callable?.kind === 'failure'), requiresExternal: count((row) => row.callable?.kind === 'requiresExternal'),
      notAdvertised: count((row) => row.callable?.kind === 'legacy'), skipped: count((row) => row.callable?.kind === 'skipped'),
      notRun: count((row) => row.callable === undefined),
    },
  };
}

/** The text of the 15 largest schemas, printed by the suite and kept in the report. */
export function largestSchemas(rows: readonly ToolRow[], count = 15): readonly ToolRow[] {
  return [...rows].sort((left, right) => right.schemaTokens - left.schemaTokens || left.name.localeCompare(right.name)).slice(0, count);
}

/** The same rows as aligned plain text, so a CI log shows the per-tool table without opening docs/tool-conformance.md. */
export function renderTextTable(rows: readonly ToolRow[]): string {
  const plain = (value: string) => value.replace(/\s+/gu, ' ').trim();
  const header = ['tool', 'group', 'static', 'discoverable', 'callable', 'tokens', 'notes'];
  const body = [...rows].sort((left, right) => left.name.localeCompare(right.name)).map((row) => {
    const discoverable = row.visibility === 'legacy' ? 'n/a' : row.discover
      ? `${row.discover.source === 'curated' ? row.discover.language : 'derived'} #${row.discover.rank} "${plain(clip(row.discover.phrase, 44))}"` : 'NOT FOUND';
    const notes = [...row.notes, ...(row.callable && (row.callable.kind === 'refusal' || row.callable.kind === 'failure') ? [`"${row.callable.note}"`] : [])];
    return [row.name, row.group, row.staticProblems.length === 0 ? 'ok' : plain(row.staticProblems.join('; ')), discoverable,
      callableCell(row.callable), String(row.schemaTokens), plain(clip(plain(notes.join('; ')), 60))];
  });
  const widths = header.map((title, column) => Math.max(title.length, ...body.map((cells) => cells[column]!.length)));
  const line = (cells: readonly string[]) => cells.map((value, column) => (column === 5 ? value.padStart(widths[column]!) : value.padEnd(widths[column]!))).join('  ').trimEnd();
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...body.map(line)].join('\n');
}

/** The generated docs/tool-conformance.md. Deterministic: sorted by tool name, no times, no ids. */
export function renderReport(rows: readonly ToolRow[], meta: { readonly ceiling: number; readonly oversize: Readonly<Record<string, { ceiling: number; reason: string }>> }): string {
  const sorted = [...rows].sort((left, right) => left.name.localeCompare(right.name));
  const summary = summarize(sorted);
  const lines: string[] = [];
  lines.push('# Tool conformance report', '');
  lines.push('Generated by `apps/backend/src/pi/tool-conformance.test.ts`. Do not edit by hand: after adding or changing a tool, regenerate it with');
  lines.push('', '```sh', 'cd apps/backend && UPDATE_TOOL_CONFORMANCE=1 npx vitest run src/pi/tool-conformance.test.ts', '```', '');
  lines.push('The suite composes every production backend module offline (in-memory stores, stubbed services, stub GitHub and Azure MCP servers), then drives the real');
  lines.push('PI MCP door (`find_tools` and `call_tool`) for every registered tool. CI fails when a tool breaks the harness contract, cannot be found, or cannot be called cleanly,');
  lines.push('and when this file no longer matches the registry.', '');
  lines.push('## How to read it', '');
  lines.push('- **static**: `ok`, or the violated rule. Rules: a harness-safe unique name (1-64 of `A-Za-z0-9_-`, no `___`, no harness-managed name, no `gh_`/`az_` prefix), an informative description (30+ characters, 6+ words, says when to use it, at most 4,000 characters), a schema the harness accepts (object root, no `strict`, no `$ref`/`$schema`, only plain JSON Schema keywords, no cycles), and a size ceiling.');
  lines.push(`- **discoverable**: the phrase that makes \`find_tools\` return the tool and where it ranks. \`curated\` phrases are what Dan says (English and Danish) and must rank in the top 3 of the first search. \`derived\` phrases come from the tool's own description; the tool must be returned by \`find_tools\` (the top 3 in full, the next 5 as compact entries that can be called by exact name too).`);
  lines.push('- **callable**: `ok` (ran against the stubs and answered with a structured result), `refusal` or `failure (typed)` (a write tool answered with a typed, plain-English ToolRefusal/ToolFailure; the note shows the words), `requiresExternal` (cannot run offline: hardware, live credentials or a paid model; it is still run with its dependency down and must fail cleanly), `not advertised` (the legacy confirmation endpoints are HTTP only; the door must treat them as unknown).');
  lines.push(`- **schema tokens**: characters / 4 of the parameters schema as the registry holds it (definition tokens in the notes include name and description). A search that returns a tool pays its definition in every turn. Ceiling ${meta.ceiling}; the exceptions below are listed with their reason. \`find_tools\` gives the model a compacted copy of a very large schema (a repeated part written once), so the largest-schemas table also shows what is sent.`, '');
  lines.push('## Summary', '');
  lines.push('| What | Count |', '| --- | ---: |');
  lines.push(`| Registered tools | ${summary.total} |`);
  lines.push(`| Visible to chat and voice | ${summary.visibility.chat} |`);
  lines.push(`| Visible only in an activation turn (situation tools) | ${summary.visibility.activation} |`);
  lines.push(`| Visible only to a background wake | ${summary.visibility.wake} |`);
  lines.push(`| Legacy confirmation endpoints (HTTP only, not advertised) | ${summary.visibility.legacy} |`);
  lines.push(`| Static contract ok | ${summary.staticOk} |`);
  lines.push(`| Discoverable, top 3 | ${summary.discoverTop3} |`);
  lines.push(`| Discoverable, listed (callable by name) | ${summary.discoverListed} |`);
  lines.push(`| Callable: ok | ${summary.callable.ok} |`);
  lines.push(`| Callable: refusal | ${summary.callable.refusal} |`);
  lines.push(`| Callable: failure (typed) | ${summary.callable.failure} |`);
  lines.push(`| Callable: requiresExternal | ${summary.callable.requiresExternal} |`);
  lines.push(`| Callable: not advertised (legacy) | ${summary.callable.notAdvertised} |`);
  lines.push(`| Callable: skipped | ${summary.callable.skipped} |`, '');
  lines.push('## The 15 largest schemas', '');
  lines.push('| # | Tool | Schema tokens | Sent by find_tools | Definition tokens |', '| ---: | --- | ---: | ---: | ---: |');
  largestSchemas(sorted).forEach((row, index) => lines.push(`| ${index + 1} | \`${row.name}\` | ${row.schemaTokens} | ${row.sentTokens} | ${row.definitionTokens} |`));
  lines.push('');
  const exceptions = Object.entries(meta.oversize);
  if (exceptions.length > 0) {
    lines.push('Schemas above the ceiling, each with a ratchet (they may not grow):', '');
    for (const [name, entry] of exceptions) lines.push(`- \`${name}\`: ceiling ${entry.ceiling} tokens; ${entry.reason}.`);
    lines.push('');
  }
  lines.push('## Tools', '');
  lines.push('| Tool | Group | Visible to | Effect | Static | Discoverable | Callable | Schema tokens | Notes |', '| --- | --- | --- | --- | --- | --- | --- | ---: | --- |');
  for (const row of sorted) {
    const discoverable = row.visibility === 'legacy' ? 'n/a' : row.discover
      ? `"${cell(clip(row.discover.phrase, 70))}" (${row.discover.source === 'curated' ? row.discover.language : 'derived'}, #${row.discover.rank})` : 'NOT FOUND';
    const notes = [...row.notes, ...(row.callable && (row.callable.kind === 'refusal' || row.callable.kind === 'failure') ? [`"${clip(row.callable.note, 90)}"`] : [])];
    lines.push(`| \`${row.name}\` | ${row.group} | ${visibilityLabel[row.visibility]} | ${row.effect} | ${row.staticProblems.length === 0 ? 'ok' : cell(row.staticProblems.join('; '))} | ${discoverable} | ${callableCell(row.callable)} | ${row.schemaTokens} | ${cell(notes.join('; '))} |`);
  }
  lines.push('');
  return `${lines.join('\n')}`;
}
