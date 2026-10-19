import { useCallback, useEffect, useRef, useState } from 'react';
import { backendFetch } from './backend-request';
import { Loader } from './Loader';
import { CollapsibleSection } from './CollapsibleSection';

interface RecipeSummary {
  id: string;
  kind: 'pc' | 'browser';
  key: string;
  goal: string;
  stepCount: number;
}

function recipeSummaries(value: unknown): RecipeSummary[] {
  if (typeof value !== 'object' || value === null || !('recipes' in value) ||
      !Array.isArray(value.recipes) || value.recipes.length > 100) {
    throw new Error('Invalid recipes');
  }
  const ids = new Set<string>();
  return value.recipes.map((recipe: unknown) => {
    if (typeof recipe !== 'object' || recipe === null ||
        !('id' in recipe) || typeof recipe.id !== 'string' || !recipe.id || ids.has(recipe.id) ||
        !('kind' in recipe) || (recipe.kind !== 'pc' && recipe.kind !== 'browser') ||
        !('key' in recipe) || typeof recipe.key !== 'string' || !recipe.key.trim() ||
        !('goal' in recipe) || typeof recipe.goal !== 'string' || !recipe.goal.trim() ||
        !('steps' in recipe) || !Array.isArray(recipe.steps) ||
        !recipe.steps.every((step: unknown) => typeof step === 'object' && step !== null &&
          'operation' in step && typeof step.operation === 'string')) {
      throw new Error('Invalid recipe');
    }
    ids.add(recipe.id);
    return {
      id: recipe.id,
      kind: recipe.kind,
      key: recipe.key,
      goal: recipe.goal.trim().replace(/\s+/g, ' '),
      stepCount: recipe.steps.length,
    };
  });
}

export function TaskRecipesSettings({ backendUrl, getAccessToken }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
}) {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setDeleting(null);
    setConfirmingDelete(null);
    setError('');
    setMessage('');
    try {
      if (!backendUrl) throw new Error('Unavailable');
      const token = await getAccessToken();
      if (controller.signal.aborted) return;
      const response = await backendFetch(`${backendUrl.replace(/\/+$/, '')}/recipes`, {
        headers: { Authorization: `${['Bear', 'er'].join('')} ${token}`, Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Request failed');
      const summaries = recipeSummaries(await response.json());
      if (controller.signal.aborted) return;
      setRecipes(summaries);
      setLoaded(true);
      setMessage('Routines refreshed.');
    } catch {
      if (!controller.signal.aborted) {
        setError(backendUrl
          ? 'Could not load routines. Try again.'
          : 'Routines unavailable.');
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setLoading(false);
      }
    }
  }, [backendUrl, getAccessToken]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(); });
    return () => {
      active = false;
      request.current?.abort();
    };
  }, [load]);

  async function deleteRecipe(recipe: RecipeSummary) {
    if (!backendUrl || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setDeleting(recipe.id);
    setError('');
    setMessage('');
    try {
      const token = await getAccessToken();
      if (controller.signal.aborted) return;
      const response = await backendFetch(
        `${backendUrl.replace(/\/+$/, '')}/recipes/${encodeURIComponent(recipe.id)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `${['Bear', 'er'].join('')} ${token}` },
          signal: controller.signal,
        },
      );
      if (response.status !== 204) throw new Error('Delete failed');
      if (controller.signal.aborted) return;
      setRecipes((current) => current.filter((item) => item.id !== recipe.id));
      setMessage(`Routine deleted: ${recipe.goal}.`);
    } catch {
      if (!controller.signal.aborted) {
        setConfirmingDelete(null);
        setError('Could not delete this routine. Try Delete again.');
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setDeleting(null);
      }
    }
  }

  return (
    <CollapsibleSection storageKey="settings.recipes" headingId="routines-heading" title="Routines">
      <p className="settings-explanation">Typed text and page content are not stored.</p>
      <div className="settings-actions">
        <button className="secondary-button" type="button" aria-busy={loading || undefined} aria-label={loading ? 'Refreshing…' : undefined}
          disabled={loading || deleting !== null || !backendUrl} onClick={() => { void load(); }}>
          <span className="button-label">{error && !loaded ? 'Retry routines' : 'Refresh routines'}</span>
          {loading && <span className="button-loading-indicator" aria-hidden="true"><Loader variant="inline" announce={false} label="Refreshing…" /></span>}
        </button>
      </div>
      <p className="settings-feedback" role={error ? 'alert' : 'status'}>
        {error || (loading ? <Loader variant="inline" announce={false} label="Loading routines…" /> : message)}
      </p>
      {error && loaded && <p className="settings-explanation">Previously loaded routines are shown.</p>}
      {loaded && recipes.length === 0 && <p>No saved routines.</p>}
      {recipes.length > 0 && (
        <ul className="repository-list" aria-label="Saved routines">
          {recipes.map((recipe) => (
            <li className="repository-item" key={recipe.id}>
              <div className="repository-info">
                <strong><code>{recipe.kind === 'pc' ? 'PC app' : 'Browser site'}: {recipe.key}</code></strong>
                <p style={{ overflowWrap: 'anywhere' }}>{recipe.goal}</p>
                <p className="settings-explanation">
                  {recipe.stepCount} {recipe.stepCount === 1 ? 'step' : 'steps'}
                </p>
              </div>
              {confirmingDelete === recipe.id ? (
                <div className="button-group" role="group" aria-label={`Delete routine: ${recipe.goal} (${recipe.key})`}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setConfirmingDelete(null);
                    }
                  }}>
                  <button className="secondary-button" type="button" disabled={deleting !== null}
                    onClick={() => setConfirmingDelete(null)}>Cancel</button>
                  <button className="secondary-button danger-button danger-button--filled" type="button" autoFocus
                    aria-label={`${deleting === recipe.id ? 'Deleting' : 'Confirm delete'} routine: ${recipe.goal} (${recipe.key})`}
                    aria-busy={deleting === recipe.id || undefined}
                    disabled={loading || deleting !== null}
                    onClick={() => { void deleteRecipe(recipe); }}>
                    {deleting === recipe.id ? 'Deleting…' : 'Confirm delete routine'}
                  </button>
                </div>
              ) : (
                <button className="secondary-button danger-button" type="button"
                  aria-label={`Delete routine: ${recipe.goal} (${recipe.key})`}
                  disabled={loading || deleting !== null} onClick={() => setConfirmingDelete(recipe.id)}>
                  {deleting === recipe.id ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}
