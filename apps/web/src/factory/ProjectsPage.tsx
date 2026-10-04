import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

interface Project {
  id: string;
  name: string;
  repo: string;
  default_branch: string;
  default_agent: 'codex' | 'copilot';
  policy: 'deliver_pr' | 'complete_without_deployment';
  merge_rules: string | null;
  sandbox_size: '1x2' | '2x4';
  tech: string;
  max_parallel_tasks: number;
  active: boolean;
}

interface ProjectValues {
  name: string;
  repo: string;
  default_branch: string;
  default_agent: string;
  policy: string;
  merge_rules: string;
  sandbox_size: string;
  tech: string;
  max_parallel_tasks: number | '';
}

type ProjectFields = Omit<Project, 'id' | 'active'>;
type LoadState = 'loading' | 'ready' | 'error';
type ProjectsPageProps = { backendUrl: string | null; getAccessToken: () => Promise<string> };

const projectIdPattern = /^[1-9]\d{0,18}$/;
const maxProjectId = 9_223_372_036_854_775_807n;
const repositoryPattern = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const techPattern = /^[a-z][a-z0-9_.-]*$/;
const maxParallelTasks = 2_147_483_647;
const emptyValues: ProjectValues = {
  name: '',
  repo: '',
  default_branch: '',
  default_agent: '',
  policy: '',
  merge_rules: '',
  sandbox_size: '',
  tech: '',
  max_parallel_tasks: 1,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProject(value: unknown): value is Project {
  if (!isObject(value)) return false;
  return typeof value.id === 'string' && projectIdPattern.test(value.id) && BigInt(value.id) <= maxProjectId &&
    typeof value.name === 'string' && typeof value.repo === 'string' &&
    typeof value.default_branch === 'string' &&
    (value.default_agent === 'codex' || value.default_agent === 'copilot') &&
    (value.policy === 'deliver_pr' || value.policy === 'complete_without_deployment') &&
    (typeof value.merge_rules === 'string' || value.merge_rules === null) &&
    (value.sandbox_size === '1x2' || value.sandbox_size === '2x4') &&
    typeof value.tech === 'string' && typeof value.max_parallel_tasks === 'number' &&
    Number.isSafeInteger(value.max_parallel_tasks) && typeof value.active === 'boolean';
}

function toProjectValues(project: Project): ProjectValues {
  return {
    name: project.name,
    repo: project.repo,
    default_branch: project.default_branch,
    default_agent: project.default_agent,
    policy: project.policy,
    merge_rules: project.merge_rules ?? '',
    sandbox_size: project.sandbox_size,
    tech: project.tech,
    max_parallel_tasks: project.max_parallel_tasks,
  };
}

function toProjectFields(values: ProjectValues): ProjectFields {
  return {
    name: values.name.trim(),
    repo: values.repo.trim(),
    default_branch: values.default_branch.trim(),
    default_agent: values.default_agent as Project['default_agent'],
    policy: values.policy as Project['policy'],
    merge_rules: values.merge_rules.trim() ? values.merge_rules : null,
    sandbox_size: values.sandbox_size as Project['sandbox_size'],
    tech: values.tech.trim(),
    max_parallel_tasks: Number(values.max_parallel_tasks),
  };
}

function validateProjectValues(values: ProjectValues): string | null {
  if (!/\S/.test(values.name) || values.name.length > 100) return 'Enter a project name with at most 100 characters.';
  if (values.repo.length < 3 || values.repo.length > 140 || !repositoryPattern.test(values.repo)) {
    return 'Enter a repository in owner/name format using letters, numbers, dots, underscores, or hyphens.';
  }
  if (!/\S/.test(values.default_branch) || values.default_branch.length > 255) {
    return 'Enter a default branch with at most 255 characters.';
  }
  if (values.default_agent !== 'codex' && values.default_agent !== 'copilot') return 'Choose a default agent.';
  if (values.policy !== 'deliver_pr' && values.policy !== 'complete_without_deployment') return 'Choose a project policy.';
  if (values.sandbox_size !== '1x2' && values.sandbox_size !== '2x4') return 'Choose a sandbox size.';
  if (values.merge_rules.length > 4000) return 'Merge rules must be at most 4,000 characters.';
  if (values.tech.length > 32 || !techPattern.test(values.tech)) {
    return 'Enter a tech identifier starting with a lowercase letter and using lowercase letters, numbers, dots, underscores, or hyphens.';
  }
  if (typeof values.max_parallel_tasks !== 'number' || !Number.isSafeInteger(values.max_parallel_tasks) ||
    values.max_parallel_tasks < 1 || values.max_parallel_tasks > maxParallelTasks) {
    return `Maximum parallel tasks must be a whole number from 1 to ${maxParallelTasks}.`;
  }
  return null;
}

function projectError(method: string, status: number): Error {
  if (status === 401) return new Error('Your Microsoft sign-in needs attention. Sign in again.');
  if (status === 503) return new Error('Project data is unavailable until the database is connected.');
  if (status === 409) return new Error('This repository is already assigned to a project. Archived repositories remain reserved.');
  if (status === 404) return new Error('This project is no longer available.');
  return new Error(`Jarvis could not ${method} project data (HTTP ${status}).`);
}

async function request(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  path: string,
  method: 'GET' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    const bearerScheme = ['Bear', 'er'].join('');
    response = await fetch(`${backendUrl}${path}`, {
      method,
      headers: {
        Authorization: `${bearerScheme} ${await getAccessToken()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'Your Microsoft sign-in needs attention. Sign in again.') throw cause;
    throw new Error('Jarvis could not reach the project service. Try again.', { cause });
  }
  if (!response.ok) throw projectError(method === 'GET' ? 'load' : 'save', response.status);
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch (cause) {
    throw new Error('Jarvis returned invalid project data. Try again.', { cause });
  }
}

async function loadProjects(backendUrl: string, getAccessToken: () => Promise<string>): Promise<Project[]> {
  const value: unknown = await request(backendUrl, getAccessToken, '/factory/projects');
  if (!Array.isArray(value) || !value.every(isProject)) {
    throw new Error('Jarvis returned invalid project data. Try again.');
  }
  return value.filter((project) => project.active);
}

async function loadRunningTasks(backendUrl: string, getAccessToken: () => Promise<string>): Promise<string[]> {
  const value: unknown = await request(backendUrl, getAccessToken, '/factory/tasks?state=Running&limit=100');
  if (!isObject(value) || !Array.isArray(value.tasks) ||
    !value.tasks.every((task) => isObject(task) && typeof task.projectId === 'string' && typeof task.state === 'string')) {
    throw new Error('Jarvis returned invalid task data. Try again.');
  }
  return value.tasks.filter((task) => task.state === 'Running').map((task) => (task as { projectId: string }).projectId);
}

function pageNotice(value: unknown): string {
  return isObject(value) && typeof value.notice === 'string' ? value.notice : '';
}

function policyLabel(policy: Project['policy']): string {
  return policy === 'deliver_pr' ? 'Deliver a pull request' : 'Complete without deployment';
}

export function ProjectsPage({ backendUrl, getAccessToken }: ProjectsPageProps) {
  const [state, setState] = useState<LoadState>(backendUrl ? 'loading' : 'error');
  const [projects, setProjects] = useState<Project[]>([]);
  const [runningCounts, setRunningCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState(backendUrl ? '' : 'Projects are unavailable until the backend is deployed.');
  const [taskError, setTaskError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [settledRequestKey, setSettledRequestKey] = useState('');
  const location = useLocation();
  const requestKey = `${backendUrl ?? ''}:${reloadKey}`;
  const visibleState: LoadState = !backendUrl ? 'error' :
    settledRequestKey === requestKey ? state : 'loading';
  const visibleError = backendUrl ? error : 'Projects are unavailable until the backend is deployed.';

  useEffect(() => {
    let active = true;
    if (!backendUrl) return () => { active = false; };
    void Promise.allSettled([
      loadProjects(backendUrl, getAccessToken),
      loadRunningTasks(backendUrl, getAccessToken),
    ]).then(([projectResult, taskResult]) => {
      if (!active) return;
      if (projectResult.status === 'rejected') {
        setError(projectResult.reason instanceof Error ? projectResult.reason.message : 'Projects could not be loaded. Try again.');
        setState('error');
        setSettledRequestKey(requestKey);
        return;
      }
      setProjects(projectResult.value);
      setState('ready');
      if (taskResult.status === 'fulfilled') {
        const counts: Record<string, number> = {};
        for (const projectId of taskResult.value) counts[projectId] = (counts[projectId] ?? 0) + 1;
        setRunningCounts(counts);
        setTaskError('');
      } else {
        setTaskError('Running task counts are unavailable. Refresh to try again.');
      }
      setSettledRequestKey(requestKey);
    });
    return () => { active = false; };
  }, [backendUrl, getAccessToken, reloadKey, requestKey]);

  const retry = () => setReloadKey((value) => value + 1);

  return (
    <section className="projects-page" aria-labelledby="projects-heading">
      <h1 id="projects-heading">Projects</h1>
      <p>Manage repositories and the defaults used for new tasks. Changes do not alter running tasks.</p>
      <div className="projects-toolbar">
        {visibleState === 'ready' && (
          <button className="secondary-button" type="button" onClick={retry}>Refresh projects</button>
        )}
      </div>
      {visibleState === 'loading' && <p className="projects-feedback" role="status">Loading projects…</p>}
      {visibleState === 'error' && (
        <div className="projects-feedback" role="alert">
          <p>{visibleError}</p>
          {backendUrl && <button className="secondary-button" type="button" onClick={retry}>Retry</button>}
        </div>
      )}
      {visibleState === 'ready' && (
        <>
          {pageNotice(location.state) && <p className="projects-feedback" role="status">{pageNotice(location.state)}</p>}
          {taskError && <p className="projects-feedback" role="status">{taskError}</p>}
          <p className="projects-freshness">Running task counts update when you refresh this page. Last release data will appear when release tracking is connected.</p>
          {projects.length === 0 ? (
            <section className="project-empty" aria-labelledby="empty-projects-heading">
              <h2 id="empty-projects-heading">No active projects</h2>
              <p>Projects are registered by Jarvis. Configure their defaults in Settings.</p>
              <Link className="home-link" to="/settings">New project defaults</Link>
            </section>
          ) : (
            <ul className="project-list" aria-label="Active projects">
              {projects.map((project) => (
                <li key={project.id}>
                  <article className="project-item" aria-labelledby={`project-${project.id}-name`}>
                    <div className="project-title-row">
                      <h2 id={`project-${project.id}-name`}>
                        <Link to={`/factory/projects/${project.id}`}>{project.name}</Link>
                      </h2>
                      <Link className="secondary-button project-edit-link" to={`/factory/projects/${project.id}`}>Edit settings</Link>
                    </div>
                    <dl className="project-meta">
                      <div><dt>Repository</dt><dd><code>{project.repo}</code></dd></div>
                      <div><dt>Default agent</dt><dd>{project.default_agent === 'codex' ? 'Codex' : 'Copilot'}</dd></div>
                      <div><dt>Policy</dt><dd>{policyLabel(project.policy)}</dd></div>
                      <div><dt>Tech</dt><dd><code>{project.tech}</code></dd></div>
                      <div><dt>Running tasks</dt><dd>{taskError ? 'Unavailable' : runningCounts[project.id] ?? 0}</dd></div>
                      <div><dt>Last release</dt><dd>Not available yet</dd></div>
                    </dl>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function ProjectSettingsPage({ backendUrl, getAccessToken }: ProjectsPageProps) {
  const projectId = useParams().projectId;
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<LoadState>('loading');
  const [values, setValues] = useState<ProjectValues>(emptyValues);
  const [savedValues, setSavedValues] = useState<ProjectValues | null>(null);
  const [error, setError] = useState(!backendUrl ? 'Project settings are unavailable until the backend is deployed.' : '');
  const [message, setMessage] = useState(pageNotice(location.state));
  const [saving, setSaving] = useState(false);
  const [showArchiveConfirmation, setShowArchiveConfirmation] = useState(false);
  const [archivePending, setArchivePending] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [validationError, setValidationError] = useState('');
  const [settledRequestKey, setSettledRequestKey] = useState('');
  const invalidProjectId = !projectId || !projectIdPattern.test(projectId) || BigInt(projectId) > maxProjectId;
  const requestKey = `${projectId ?? ''}:${retryKey}`;
  const visibleState: LoadState = !backendUrl || invalidProjectId ? 'error' :
    settledRequestKey === requestKey ? state : 'loading';
  const visibleError = !backendUrl
    ? 'Project settings are unavailable until the backend is deployed.'
    : invalidProjectId ? 'This project address is invalid.' : error;

  useEffect(() => {
    let active = true;
    if (!backendUrl || invalidProjectId || !projectId) return () => { active = false; };
    void loadProjects(backendUrl, getAccessToken).then((projects) => {
      if (!active) return;
      const project = projects.find((item) => item.id === projectId);
      if (!project) throw new Error('This project is no longer available.');
      const nextValues = toProjectValues(project);
      setValues(nextValues);
      setSavedValues(nextValues);
      setState('ready');
      setSettledRequestKey(requestKey);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : 'Project settings could not be loaded. Try again.');
      setState('error');
      setSettledRequestKey(requestKey);
    });
    return () => { active = false; };
  }, [backendUrl, getAccessToken, invalidProjectId, projectId, requestKey]);

  const update = (key: keyof ProjectValues, value: string | number) => {
    setValues((current) => ({ ...current, [key]: value }));
    setError('');
    setMessage('');
    setValidationError('');
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!backendUrl || !projectId || saving || archivePending) return;
    const validation = validateProjectValues(values);
    if (validation) {
      setValidationError(validation);
      return;
    }
    const fields = toProjectFields(values);
    const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) =>
      value !== (key === 'merge_rules' && savedValues?.merge_rules.trim() === '' ? null : savedValues?.[key as keyof ProjectValues]),
    )) as Partial<ProjectFields>;
    if (Object.keys(changed).length === 0) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await request(
        backendUrl,
        getAccessToken,
        `/factory/projects/${projectId}`,
        'PATCH',
        changed,
      );
      if (!isProject(result) || !result.active) throw new Error('Jarvis returned invalid project data. Try again.');
      const nextValues = toProjectValues(result);
      setValues(nextValues);
      setSavedValues(nextValues);
      setMessage('Saved. These defaults apply to new tasks only; running tasks keep their current settings.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Project settings could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!backendUrl || !projectId || archivePending) return;
    setArchivePending(true);
    setError('');
    try {
      await request(backendUrl, getAccessToken, `/factory/projects/${projectId}`, 'DELETE');
      navigate('/factory/projects', { replace: true, state: { notice: 'Project archived. Its task history is retained and its repository remains reserved.' } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Project could not be archived. Try again.');
      setShowArchiveConfirmation(false);
    } finally {
      setArchivePending(false);
    }
  };

  const dirty = savedValues !== null &&
    JSON.stringify(toProjectFields(values)) !== JSON.stringify(toProjectFields(savedValues));
  const disabled = saving || archivePending;

  if (visibleState === 'loading') {
    return <section aria-labelledby="project-settings-heading"><h1 id="project-settings-heading">Project settings</h1><p role="status">Loading project settings…</p></section>;
  }

  return (
    <section className="project-settings-page" aria-labelledby="project-settings-heading">
      <h1 id="project-settings-heading">Project settings</h1>
      <p>These defaults apply to new tasks only. Running tasks keep their current settings.</p>
      {visibleState === 'error' ? (
        <div className="projects-feedback" role="alert">
          <p>{visibleError}</p>
          {backendUrl && projectId && !invalidProjectId && <button className="secondary-button" type="button" onClick={() => setRetryKey((value) => value + 1)}>Retry</button>}
          <Link className="home-link" to="/factory/projects">Back to projects</Link>
        </div>
      ) : (
        <form className="project-form" noValidate onSubmit={(event) => { void save(event); }}>
          {error && <p className="projects-feedback" role="alert">{error}</p>}
          {validationError && <p className="projects-feedback" role="alert">{validationError}</p>}
          <section className="settings-section" aria-labelledby="project-repository-heading">
            <h2 id="project-repository-heading">Repository</h2>
            <div className="projects-form-grid">
              <div className="settings-field">
                <label htmlFor="project-name">Project name</label>
                <input id="project-name" value={values.name} maxLength={100} required disabled={disabled}
                  onChange={(event) => update('name', event.target.value)} />
              </div>
              <div className="settings-field">
                <label htmlFor="project-repo">Repository (owner/name)</label>
                <input id="project-repo" value={values.repo} maxLength={140} pattern="[A-Za-z0-9._-]+/[A-Za-z0-9._-]+"
                  required disabled={disabled} onChange={(event) => update('repo', event.target.value)} />
              </div>
              <div className="settings-field">
                <label htmlFor="project-branch">Default branch</label>
                <input id="project-branch" value={values.default_branch} maxLength={255} required disabled={disabled}
                  onChange={(event) => update('default_branch', event.target.value)} />
              </div>
              <div className="settings-field">
                <label htmlFor="project-tech">Tech identifier</label>
                <input id="project-tech" value={values.tech} maxLength={32} pattern="[a-z][a-z0-9_.-]*"
                  required disabled={disabled} onChange={(event) => update('tech', event.target.value)} />
              </div>
            </div>
          </section>
          <section className="settings-section" aria-labelledby="project-task-defaults-heading">
            <h2 id="project-task-defaults-heading">Task defaults</h2>
            <div className="projects-form-grid">
              <div className="settings-field">
                <label htmlFor="project-agent">Default agent</label>
                <select id="project-agent" value={values.default_agent} required disabled={disabled}
                  onChange={(event) => update('default_agent', event.target.value)}>
                  <option value="">Choose an agent</option>
                  <option value="codex">Codex</option>
                  <option value="copilot">Copilot</option>
                </select>
              </div>
              <div className="settings-field">
                <label htmlFor="project-policy">Policy</label>
                <select id="project-policy" value={values.policy} required disabled={disabled}
                  onChange={(event) => update('policy', event.target.value)}>
                  <option value="">Choose a policy</option>
                  <option value="deliver_pr">Deliver a pull request</option>
                  <option value="complete_without_deployment">Complete without deployment</option>
                </select>
              </div>
              <div className="settings-field">
                <label htmlFor="project-max-tasks">Maximum parallel tasks</label>
                <input id="project-max-tasks" type="number" min="1" max={maxParallelTasks} step="1"
                  value={values.max_parallel_tasks} required disabled={disabled}
                  onChange={(event) => update('max_parallel_tasks', event.target.value === '' ? '' : Number(event.target.value))} />
              </div>
              <div className="settings-field">
                <label htmlFor="project-merge-rules">Merge rules</label>
                <textarea id="project-merge-rules" maxLength={4000} value={values.merge_rules} disabled={disabled}
                  onChange={(event) => update('merge_rules', event.target.value)} />
              </div>
            </div>
          </section>
          <section className="settings-section" aria-labelledby="project-sandbox-heading">
            <h2 id="project-sandbox-heading">Sandbox</h2>
            <div className="projects-form-grid">
              <div className="settings-field">
                <label htmlFor="project-sandbox">Sandbox size</label>
                <select id="project-sandbox" value={values.sandbox_size} required disabled={disabled}
                  onChange={(event) => update('sandbox_size', event.target.value)}>
                  <option value="">Choose a sandbox size</option>
                  <option value="1x2">1×2</option>
                  <option value="2x4">2×4</option>
                </select>
              </div>
            </div>
          </section>
          <div className="settings-save">
            <button className="primary-button" type="submit" disabled={disabled || !dirty}>
              {saving ? 'Saving…' : 'Save project'}
            </button>
            <Link className="secondary-button" to="/factory/projects">Cancel</Link>
            {message && <p className="settings-feedback" role="status">{message}</p>}
          </div>
          <section className="project-archive" aria-labelledby="archive-project-heading">
            <h2 id="archive-project-heading">Archive project</h2>
            <p>Archiving hides this project from active lists. Its task history stays available and its repository remains reserved.</p>
            {!showArchiveConfirmation ? (
              <button className="secondary-button" type="button" disabled={disabled}
                onClick={() => setShowArchiveConfirmation(true)}>Archive project</button>
            ) : (
              <div className="project-archive-confirm" role="group" aria-label="Confirm project archive">
                <p>Archive {values.name || 'this project'}?</p>
                <div className="settings-actions">
                  <button className="primary-button" type="button" disabled={disabled} onClick={() => { void archive(); }}>
                    {archivePending ? 'Archiving…' : 'Confirm archive'}
                  </button>
                  <button className="secondary-button" type="button" disabled={disabled}
                    onClick={() => setShowArchiveConfirmation(false)}>Cancel archive</button>
                </div>
              </div>
            )}
          </section>
        </form>
      )}
    </section>
  );
}
