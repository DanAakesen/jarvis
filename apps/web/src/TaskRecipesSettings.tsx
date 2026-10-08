import { useCallback, useEffect, useRef, useState } from 'react';
import { backendFetch } from './backend-request';
import { Loader } from './Loader';

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
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setDeleting(null);
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
      setMessage('Task recipes refreshed.');
    } catch {
      if (!controller.signal.aborted) {
        setError(backendUrl
          ? 'Could not load task recipes. Try again.'
          : 'Task recipes are unavailable until the backend is deployed.');
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
      setMessage(`Recipe deleted: ${recipe.goal}.`);
    } catch {
      if (!controller.signal.aborted) setError('Could not delete this recipe. Try Delete again.');
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setDeleting(null);
      }
    }
  }

  return (
    <section className="settings-section" aria-labelledby="task-recipes-heading">
      <h2 id="task-recipes-heading">Task recipes</h2>
      <p className="settings-explanation">
        Recipes replay verified steps for an app or site. Typed text and page content are not stored.
        Delete a recipe to stop reusing those steps.
      </p>
      <div className="settings-actions">
        <button className="secondary-button" type="button"
          disabled={loading || deleting !== null || !backendUrl} onClick={() => { void load(); }}>
          {loading ? <Loader variant="inline" announce={false} label="Refreshing…" /> : error && !loaded ? 'Retry task recipes' : 'Refresh task recipes'}
        </button>
      </div>
      <p className="settings-feedback" role={error ? 'alert' : 'status'}>
        {error || (loading ? <Loader variant="inline" announce={false} label="Loading task recipes…" /> : message)}
      </p>
      {error && loaded && <p className="settings-explanation">Previously loaded recipes are shown.</p>}
      {loaded && recipes.length === 0 && <p>No task recipes saved yet.</p>}
      {recipes.length > 0 && (
        <ul className="repository-list" aria-label="Saved task recipes">
          {recipes.map((recipe) => (
            <li className="repository-item" key={recipe.id}>
              <div className="repository-info">
                <strong><code>{recipe.kind === 'pc' ? 'PC app' : 'Browser site'}: {recipe.key}</code></strong>
                <p style={{ overflowWrap: 'anywhere' }}>{recipe.goal}</p>
                <p className="settings-explanation">
                  {recipe.stepCount} {recipe.stepCount === 1 ? 'step' : 'steps'}
                </p>
              </div>
              <button className="secondary-button" type="button"
                aria-label={`Delete recipe: ${recipe.goal} (${recipe.key})`}
                disabled={loading || deleting !== null} onClick={() => { void deleteRecipe(recipe); }}>
                {deleting === recipe.id ? 'Deleting…' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
