import { useEffect, useState, type FormEvent } from 'react';
import { backendFetch } from '../backend-request';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Modal } from '../Modal';
import { useConversationIntents } from '../conversation-intents';
import { Loader } from '../Loader';
import { CollapsibleSection } from '../CollapsibleSection';

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

interface ExistingRepository {
  fullName: string;
  name: string;
  defaultBranch: string;
  pushedAt: string | null;
  language: string | null;
}

interface RepositoryListing {
  repositories: ExistingRepository[];
  fetchedAt: string;
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

function projectError(operation: 'load' | 'save' | 'manage', status: number): Error {
  if (status === 401) return new Error('Your Microsoft sign-in needs attention. Sign in again.');
  if (status === 503) return new Error('Project or repository data unavailable.');
  if (status === 502) return new Error('GitHub repository data is unavailable. Try again.');
  if (status === 409) return new Error('This repository is already assigned to a project. Archived repositories remain reserved.');
  if (status === 404 && operation === 'manage') return new Error('This repository is no longer available through the GitHub App.');
  if (status === 404) return new Error('This project is no longer available.');
  return new Error(`Jarvis could not ${operation} project data (HTTP ${status}).`);
}

async function request(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    const bearerScheme = ['Bear', 'er'].join('');
    response = await backendFetch(`${backendUrl}${path}`, {
      method,
      headers: {
        Authorization: `${bearerScheme} ${await getAccessToken()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'Your Microsoft sign-in needs attention. Sign in again.') throw cause;
    throw new Error('Jarvis could not reach the project service. Try again.', { cause });
  }
  if (!response.ok) {
    const operation = path === '/factory/projects/manage' ? 'manage' : method === 'GET' ? 'load' : 'save';
    throw projectError(operation, response.status);
  }
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

function isExistingRepository(value: unknown): value is ExistingRepository {
  if (!isObject(value)) return false;
  return typeof value.fullName === 'string' && repositoryPattern.test(value.fullName) &&
    typeof value.name === 'string' && value.name.length <= 100 &&
    typeof value.defaultBranch === 'string' && value.defaultBranch.length > 0 && value.defaultBranch.length <= 255 &&
    (value.pushedAt === null || (typeof value.pushedAt === 'string' && Number.isFinite(Date.parse(value.pushedAt)))) &&
    (value.language === null || (typeof value.language === 'string' && value.language.length <= 100));
}

async function loadRepositories(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  refresh: boolean,
): Promise<RepositoryListing> {
  const value: unknown = await request(
    backendUrl,
    getAccessToken,
    `/factory/repositories${refresh ? '?refresh=true' : ''}`,
  );
  if (!isObject(value) || !Array.isArray(value.repositories) ||
    !value.repositories.every(isExistingRepository) ||
    typeof value.fetchedAt !== 'string' || !Number.isFinite(Date.parse(value.fetchedAt))) {
    throw new Error('Jarvis returned invalid repository data. Try again.');
  }
  return { repositories: value.repositories, fetchedAt: value.fetchedAt };
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

function repositoryDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function ProjectsPage({ backendUrl, getAccessToken }: ProjectsPageProps) {
  const [state, setState] = useState<LoadState>(backendUrl ? 'loading' : 'error');
  const [projects, setProjects] = useState<Project[]>([]);
  const [repositories, setRepositories] = useState<ExistingRepository[]>([]);
  const [repositoryFetchedAt, setRepositoryFetchedAt] = useState('');
  const [repositoryState, setRepositoryState] = useState<LoadState>(backendUrl ? 'loading' : 'error');
  const [repositoryError, setRepositoryError] = useState('');
  const [runningCounts, setRunningCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState(backendUrl ? '' : 'Projects unavailable.');
  const [taskError, setTaskError] = useState('');
  const [manageError, setManageError] = useState('');
  const [manageMessage, setManageMessage] = useState('');
  const [managingRepository, setManagingRepository] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [settledRequestKey, setSettledRequestKey] = useState('');
  const location = useLocation();
  const requestKey = `${backendUrl ?? ''}:${reloadKey}`;
  const visibleState: LoadState = !backendUrl ? 'error' :
    settledRequestKey === requestKey ? state : 'loading';
  const visibleError = backendUrl ? error : 'Projects unavailable.';

  useEffect(() => {
    let active = true;
    if (!backendUrl) return () => { active = false; };
    void Promise.allSettled([
      loadProjects(backendUrl, getAccessToken),
      loadRunningTasks(backendUrl, getAccessToken),
      loadRepositories(backendUrl, getAccessToken, reloadKey > 0),
    ]).then(([projectResult, taskResult, repositoryResult]) => {
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
      if (repositoryResult.status === 'fulfilled') {
        setRepositories(repositoryResult.value.repositories);
        setRepositoryFetchedAt(repositoryResult.value.fetchedAt);
        setRepositoryState('ready');
        setRepositoryError('');
      } else {
        setRepositoryState('error');
        setRepositoryError(repositoryResult.reason instanceof Error
          ? repositoryResult.reason.message
          : 'Existing repositories could not be loaded. Try again.');
      }
      setSettledRequestKey(requestKey);
    });
    return () => { active = false; };
  }, [backendUrl, getAccessToken, reloadKey, requestKey]);

  const retry = () => setReloadKey((value) => value + 1);
  const manageRepository = async (repository: ExistingRepository) => {
    if (!backendUrl || managingRepository) return;
    setManagingRepository(repository.fullName);
    setManageError('');
    setManageMessage('');
    try {
      const value = await request(
        backendUrl,
        getAccessToken,
        '/factory/projects/manage',
        'POST',
        { repository: repository.fullName },
      );
      if (!isProject(value) || !value.active) throw new Error('Jarvis returned invalid project data. Try again.');
      setProjects((current) => [...current.filter((project) => project.repo.toLowerCase() !== value.repo.toLowerCase()), value]);
      setRepositories((current) => current.filter((item) => item.fullName.toLowerCase() !== value.repo.toLowerCase()));
      setManageMessage(`Managed ${value.repo} with Jarvis.`);
    } catch (cause) {
      setManageError(cause instanceof Error ? cause.message : `Jarvis could not manage ${repository.fullName}. Try again.`);
    } finally {
      setManagingRepository('');
    }
  };
  const managedRepositories = new Set(projects.map((project) => project.repo.toLowerCase()));
  const otherRepositories = repositories.filter((repository) => !managedRepositories.has(repository.fullName.toLowerCase()));

  return (
    <CollapsibleSection storageKey="settings.projects" className="projects-page" id="projects" headingId="projects-heading" title="Projects">
      <div className="projects-toolbar">
        {visibleState === 'ready' && (
          <button className="secondary-button" type="button" onClick={retry}>Refresh projects and repositories</button>
        )}
      </div>
      {visibleState === 'loading' && <Loader variant="rows" label="Loading projects…" />}
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
          {manageMessage && <p className="projects-feedback" role="status">{manageMessage}</p>}
          {manageError && <p className="projects-feedback" role="alert">{manageError}</p>}
          {projects.length === 0 ? (
            <section className="project-empty" aria-labelledby="empty-projects-heading">
              <h3 id="empty-projects-heading">No managed projects</h3>
              <Link className="home-link" to="/settings">New project defaults</Link>
            </section>
          ) : (
            <ul className="project-list" aria-label="Active projects">
              {projects.map((project) => (
                <li key={project.id}>
                  <article className="project-item" aria-labelledby={`project-${project.id}-name`}>
                    <div className="project-title-row">
                      <h3 id={`project-${project.id}-name`}>
                        <Link to={`/factory/projects/${project.id}`}>{project.name}</Link>
                      </h3>
                      <Link className="secondary-button project-edit-link" to={`/factory/projects/${project.id}`}>Edit settings</Link>
                    </div>
                    <dl className="project-meta">
                      <div><dt>Repository</dt><dd><code>{project.repo}</code></dd></div>
                      <div><dt>Default agent</dt><dd>{project.default_agent === 'codex' ? 'Codex' : 'Copilot'}</dd></div>
                      <div><dt>Policy</dt><dd>{policyLabel(project.policy)}</dd></div>
                      <div><dt>Tech</dt><dd><code>{project.tech}</code></dd></div>
                      <div><dt>Running tasks</dt><dd>{taskError ? 'Unavailable' : runningCounts[project.id] ?? 0}</dd></div>
                      <div><dt>Last release</dt><dd><Link to={`/factory/projects/${project.id}/releases`}>View releases</Link></dd></div>
                    </dl>
                  </article>
                </li>
              ))}
            </ul>
          )}
          <section className="existing-repositories" aria-labelledby="existing-repositories-heading">
            <h3 id="existing-repositories-heading">Existing repositories</h3>
            {repositoryFetchedAt && (
              <p className="repository-freshness">Repository list refreshed {repositoryDate(repositoryFetchedAt)}.</p>
            )}
            {repositoryState === 'loading' && <Loader variant="rows" label="Loading existing repositories…" />}
            {repositoryState === 'error' && (
              <div className="projects-feedback" role="alert">
                <p>{repositoryError}</p>
                <button className="secondary-button" type="button" onClick={retry}>Retry repository list</button>
              </div>
            )}
            {repositoryState === 'ready' && otherRepositories.length === 0 && (
              <p className="projects-feedback">No repositories to add.</p>
            )}
            {otherRepositories.length > 0 && (
              <ul className="repository-list" aria-label="Repositories not managed by Jarvis">
                {otherRepositories.map((repository) => (
                  <li key={repository.fullName.toLowerCase()}>
                    <article className="repository-item" aria-labelledby={`repository-${repository.name}-name`}>
                      <div className="repository-info">
                        <h4 id={`repository-${repository.name}-name`}><code>{repository.fullName}</code></h4>
                        <dl className="repository-meta">
                          <div>
                            <dt>Last push</dt>
                            <dd>{repository.pushedAt
                              ? <time dateTime={repository.pushedAt}>{repositoryDate(repository.pushedAt)}</time>
                              : 'Not pushed yet'}</dd>
                          </div>
                          <div><dt>Language</dt><dd>{repository.language ?? 'Not reported'}</dd></div>
                        </dl>
                      </div>
                      <button className="secondary-button" type="button" disabled={!!managingRepository}
                        onClick={() => { void manageRepository(repository); }}>
                        {managingRepository === repository.fullName ? 'Managing…' : 'Manage with Jarvis'}
                      </button>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </CollapsibleSection>
  );
}

export function ProjectSettingsPage({ backendUrl, getAccessToken }: ProjectsPageProps) {
  const projectId = useParams().projectId;
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<LoadState>('loading');
  const [values, setValues] = useState<ProjectValues>(emptyValues);
  const [savedValues, setSavedValues] = useState<ProjectValues | null>(null);
  const [error, setError] = useState(!backendUrl ? 'Project settings unavailable.' : '');
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
    ? 'Project settings unavailable.'
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
      setMessage('Saved for new tasks.');
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
      navigate('/settings#projects', { replace: true, state: { notice: 'Project archived. Its task history is retained and its repository remains reserved.' } });
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
    return <section aria-labelledby="project-settings-heading"><h1 id="project-settings-heading">Project settings</h1><Loader variant="core" label="Loading project settings…" /></section>;
  }

  return (
    <section className="project-settings-page" aria-labelledby="project-settings-heading">
      <h1 id="project-settings-heading">Project settings</h1>
      <p>Applies to new tasks only.</p>
      {visibleState === 'error' ? (
        <div className="projects-feedback" role="alert">
          <p>{visibleError}</p>
          {backendUrl && projectId && !invalidProjectId && <button className="secondary-button" type="button" onClick={() => setRetryKey((value) => value + 1)}>Retry</button>}
          <Link className="home-link" to="/settings#projects">Back to projects</Link>
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
            <Link className="secondary-button" to="/settings#projects">Cancel</Link>
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

/**
 * Create project from the Kanban board. An existing GitHub repository is added with the same manage action
 * as Settings; a brand-new repository is requested from Jarvis, which creates and registers projects.
 */
export function CreateProjectDialog({ backendUrl, getAccessToken, onClose, onAdded }: ProjectsPageProps & {
  onClose: () => void;
  onAdded: (repository: string) => void;
}) {
  const [state, setState] = useState<LoadState>(backendUrl ? 'loading' : 'error');
  const [error, setError] = useState(backendUrl ? '' : 'Projects unavailable.');
  const [repositories, setRepositories] = useState<ExistingRepository[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [managing, setManaging] = useState('');
  const [manageError, setManageError] = useState('');
  const [idea, setIdea] = useState('');
  const conversationIntents = useConversationIntents();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    if (!backendUrl) return () => { active = false; };
    void Promise.all([loadProjects(backendUrl, getAccessToken), loadRepositories(backendUrl, getAccessToken, reloadKey > 0)])
      .then(([projects, listing]) => {
        if (!active) return;
        const managed = new Set(projects.map((project) => project.repo.toLowerCase()));
        setRepositories(listing.repositories.filter((repository) => !managed.has(repository.fullName.toLowerCase())));
        setState('ready');
        setError('');
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setState('error');
        setError(cause instanceof Error ? cause.message : 'Existing repositories could not be loaded. Try again.');
      });
    return () => { active = false; };
  }, [backendUrl, getAccessToken, reloadKey]);

  const manage = async (repository: ExistingRepository) => {
    if (!backendUrl || managing) return;
    setManaging(repository.fullName);
    setManageError('');
    try {
      const value = await request(backendUrl, getAccessToken, '/factory/projects/manage', 'POST', { repository: repository.fullName });
      if (!isProject(value) || !value.active) throw new Error('Jarvis returned invalid project data. Try again.');
      onAdded(value.repo);
    } catch (cause) {
      setManageError(cause instanceof Error ? cause.message : `Jarvis could not manage ${repository.fullName}. Try again.`);
    } finally {
      setManaging('');
    }
  };

  const askJarvis = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const description = idea.trim();
    if (!description) return;
    conversationIntents.sendMessage(`Create a new project: ${description}`);
    navigate('/');
  };

  return (
    <Modal title="Create project" titleId="create-project-heading" onClose={onClose} busy={!!managing} className="task-dialog project-dialog">
        <section className="project-dialog-part" aria-labelledby="project-existing-heading">
          <h3 id="project-existing-heading">From an existing repository</h3>
          {state === 'loading' && <Loader variant="rows" label="Loading repositories…" />}
          {state === 'error' && (
            <div className="tasks-feedback" role="alert">
              <p>{error}</p>
              {backendUrl && <button className="secondary-button" type="button" onClick={() => { setState('loading'); setReloadKey((value) => value + 1); }}>Retry</button>}
            </div>
          )}
          {state === 'ready' && repositories.length === 0 && <p>No repositories to add.</p>}
          {state === 'ready' && repositories.length > 0 && (
            <ul className="project-dialog-repositories" aria-label="Repositories you can add">
              {repositories.map((repository) => (
                <li key={repository.fullName.toLowerCase()}>
                  <span>
                    <code>{repository.fullName}</code>
                    <small>{repository.language ?? 'Language not reported'}{repository.pushedAt ? ` · pushed ${repositoryDate(repository.pushedAt)}` : ''}</small>
                  </span>
                  <button className="secondary-button" type="button" disabled={!!managing}
                    onClick={() => { void manage(repository); }}>
                    {managing === repository.fullName ? 'Adding…' : 'Add'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {manageError && <p className="tasks-feedback" role="alert">{manageError}</p>}
        </section>
        <form className="project-dialog-part task-create-form" onSubmit={askJarvis}>
          <h3>Start a new repository</h3>
          <div className="task-form-field">
            <label htmlFor="new-project-idea">What should Jarvis build?</label>
            <textarea id="new-project-idea" rows={3} maxLength={2_000} value={idea} onChange={(event) => setIdea(event.target.value)} />
          </div>
          <div className="task-dialog-actions">
            <button className="primary-button" type="submit" disabled={!idea.trim()}>Ask Jarvis to create it</button>
          </div>
        </form>
    </Modal>
  );
}