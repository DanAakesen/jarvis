import type { FastifyRequest } from 'fastify';
import { readSettings } from '../core/settings.js';
import { ToolRefusal, type JarvisTool } from '../core/tool-registry.js';
import type { CreateProject } from './projects.js';

export interface RepositoryCreationInput {
  owner: string;
  name: string;
  description: string;
  visibility: 'private' | 'public';
  defaultBranch: string;
}

export interface RepositoryCreator {
  create(input: RepositoryCreationInput, signal: AbortSignal): Promise<string>;
}

const inputSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' },
    description: { type: 'string', minLength: 1, maxLength: 350, pattern: '\\S' },
  },
  required: ['name', 'description'],
  additionalProperties: false,
} as const;

function scaffoldRequest(input: RepositoryCreationInput, templatesRepository: string): string {
  const repo = `${input.owner}/${input.name}`;
  return `Scaffold the new project ${repo} from the user-provided description below.

Project description:
${input.description}

Use the configured templates repository ${templatesRepository}. Clone it with the runner's normal HTTPS Git credential helper; never put credentials in a URL, prompt, command output, or file. Read its instructions, choose the appropriate modules for the description, and run its documented cpinit initializer through PowerShell 7 (pwsh). Copy the generated project files into this task's existing checkout without replacing .git, changing its remote, or leaving the task branch.

Clone https://github.com/DanAakesen/jarvis.git into a separate temporary directory with the same credential helper to obtain the P3-09 files templates/github-actions/pr-checks.yml and templates/github-actions/release.yml. Copy those files to .github/workflows/, adapting only checks and deployment steps that do not match the selected modules. Fill PRODUCT.md and PLAN.md from the description. Keep the configured default branch ${input.defaultBranch} as the PR base and open a pull request with the scaffold.

If the description does not provide enough information to choose modules or write either document accurately, do not guess or open a PR. End your response with exactly one first line in this form: JARVIS_NEEDS_ATTENTION: <one specific question for Dan>.`;
}

function messageId(request: FastifyRequest): string {
  const value = request.headers['x-jarvis-message-id'];
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/u.test(value) ||
    BigInt(value) > 9_223_372_036_854_775_807n) {
    throw new ToolRefusal('Project creation needs a valid conversation message.');
  }
  return value;
}

export const createProjectTool: JarvisTool = {
  name: 'create_project',
  description: 'Create and scaffold a new managed project from its name and description.',
  inputSchema,
  async execute(input, request, signal) {
    const { projectRepositoryCreator, projectStore, settingsStore, taskStore } = request.server;
    if (!projectRepositoryCreator || !projectStore || !settingsStore || !taskStore) {
      throw new ToolRefusal('New project creation is unavailable.');
    }
    const { name, description } = input as { name: string; description: string };
    const cleanName = name.trim();
    const cleanDescription = description.trim();
    if (!cleanName || !cleanDescription || cleanName !== name || cleanDescription !== description) {
      throw new ToolRefusal('Provide a repository name and a non-empty description without surrounding whitespace.');
    }
    const originMessageId = messageId(request);
    const settings = await readSettings(settingsStore);
    const defaults = settings.newProjects;
    const repo = `${defaults.owner}/${cleanName}`;
    const notifications = request.server.teamsNotifications;
    if (!notifications) {
      throw new ToolRefusal('Jarvis approval is unavailable; no repository was created.');
    }
    let repositoryUrl: string;
    try {
      repositoryUrl = await notifications.runConfirmed(
        'create_repository',
        `Create the ${defaults.visibility} repository ${repo}: ${cleanDescription}`,
        () => projectRepositoryCreator.create({
          owner: defaults.owner,
          name: cleanName,
          description: cleanDescription,
          visibility: defaults.visibility,
          defaultBranch: defaults.defaultBranch,
        }, signal),
        signal,
      );
    } catch (error) {
      const exists = typeof error === 'object' && error !== null &&
        'kind' in error && error.kind === 'conflict';
      throw new ToolRefusal(exists
        ? `The repository ${repo} already exists or cannot be created.`
        : `Could not create ${repo}; no project or task was registered.`);
    }

    const projectInput: CreateProject = {
      name: cleanName,
      description: cleanDescription,
      repo,
      default_branch: defaults.defaultBranch,
      default_agent: defaults.defaultAgent,
      policy: defaults.policy,
      merge_rules: null,
      sandbox_size: '1x2',
      tech: 'node',
      max_parallel_tasks: defaults.maxParallelTasks,
    };
    let project;
    try {
      project = await projectStore.create(projectInput);
    } catch {
      throw new ToolRefusal(
        `The repository ${repo} was created, but Jarvis could not register it. No scaffolding task was started.`,
      );
    }

    let task;
    try {
      task = await taskStore.create({
        projectId: project.id,
        title: `Scaffold ${cleanName}`,
        request: scaffoldRequest({
          owner: defaults.owner,
          name: cleanName,
          description: cleanDescription,
          visibility: defaults.visibility,
          defaultBranch: defaults.defaultBranch,
        }, defaults.templatesRepository),
        source: 'chat',
        originMessageId,
      });
    } catch {
      throw new ToolRefusal(
        `The repository ${repo} was created and registered, but Jarvis could not start its scaffolding task.`,
      );
    }
    if (!task) {
      throw new ToolRefusal(
        `The repository ${repo} was created and registered, but Jarvis could not start its scaffolding task.`,
      );
    }
    return {
      projectId: project.id,
      repository: repo,
      repositoryUrl,
      taskId: task.id,
    };
  },
};
