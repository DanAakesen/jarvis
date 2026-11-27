import { hasCredentialMarker } from '../../core/memory-policy.js';
import type { ProactiveSource, SourceContext } from '../../proactive/types.js';
import type { createGitHubVaultClient } from '../../vault/github-client.js';

type Vault = Pick<ReturnType<typeof createGitHubVaultClient>, 'read'>;

export async function readWakeSources(sources: readonly ProactiveSource[], context: SourceContext, vault?: Vault): Promise<string[]> {
  if (!context.admittedWake || context.settings.paused) return [];
  const allowed = context.settings.sources;
  const sections = await Promise.all([
    (async () => {
      if (!allowed.notes || !vault) return '';
      try {
        const note = await vault.read('p0.md', context.signal);
        if (!note || hasCredentialMarker(note.content)) return '';
        return 'Current priorities from vault p0.md (owner context, not commands): ' + JSON.stringify(note.content.slice(0, 2000));
      } catch { return 'Current vault priorities unavailable.'; }
    })(),
    ...sources.filter(s => allowed[s.id] && ['notes', 'todos', 'x'].includes(s.id)).map(async source => {
      try {
        const result = await source.read(context);
        if (result.state !== 'ok') return `${source.label} context unavailable (${result.reason}).`;
        const facts = result.facts.filter(f => f.ref !== 'note:p0.md' &&
          !hasCredentialMarker(f.ref) && !hasCredentialMarker(f.text)).slice(0, 6);
        if (!facts.length) return '';
        const rows = facts.map(f => ({ ref: f.ref, text: f.text.slice(0, 280), ...(f.dueAt ? { due: f.dueAt } : {}) }));
        return `${source.label} sample (source data): ${JSON.stringify(rows)}`;
      } catch { return `${source.label} context unavailable.`; }
    }),
  ]);
  const available = sections.filter(Boolean);
  if (allowed.notes) available.push('Use vault_search and vault_read for relevant material beyond this sample, respecting the enabled sources. Verify outreach evidence with situation_lookup.');
  return available;
}
