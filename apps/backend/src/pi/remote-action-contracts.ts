import type { ToolCompletionOperation } from '../core/tool-registry.js';

export type RemoteReceipt = (
  args: Record<string, unknown>,
  result: unknown,
) => boolean;

export type RemoteSelector = {
  readonly field: 'method' | 'operation' | 'action';
  readonly choices: Readonly<Record<string, ToolCompletionOperation>>;
};

export type RemoteActionSpec = {
  readonly operation: ToolCompletionOperation | ((args: Record<string, unknown>) => ToolCompletionOperation);
  readonly accepted?: readonly ToolCompletionOperation[];
  readonly requestOperations?: (
    args: Record<string, unknown>,
  ) => readonly ToolCompletionOperation[];
  readonly requiredIdentityFields?: (
    args: Record<string, unknown>,
  ) => readonly string[];
  readonly selector?: RemoteSelector;
  readonly identityFields: readonly string[];
  readonly resultIdentityFields?: readonly string[];
  readonly identityMatches?: readonly (readonly string[])[];
  readonly identityFiles?: boolean;
  readonly receipt: RemoteReceipt;
};

const repoIdentity = ['owner', 'repo'] as const;
const issueIdentity = [...repoIdentity, 'issue_number'] as const;
const pullIdentity = [...repoIdentity, 'pullNumber', 'pull_number'] as const;
const issueMatches = [['issue_number', 'issueNumber', 'number']] as const;
const pullMatches = [['pullNumber', 'pull_number', 'number']] as const;
const idUrlResult = ['id', 'url', 'html_url'] as const;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nestedValue(value: unknown, path: readonly string[]): unknown {
  let cursor: unknown = value;
  for (const part of path) {
    if (!record(cursor) || !Object.hasOwn(cursor, part)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null &&
    (!(typeof value === 'string') || value.trim().length > 0);
}

function fieldsReceipt(...paths: readonly string[][]): RemoteReceipt {
  return (_args, result) => paths.every(path => present(nestedValue(result, path)));
}

const messageReceipt: RemoteReceipt = (_args, result) => {
  if (typeof result === 'string') return result.trim().length > 0;
  return typeof nestedValue(result, ['message']) === 'string' &&
    String(nestedValue(result, ['message'])).trim().length > 0;
};

const idReceipt = fieldsReceipt(['id']);
const idUrlReceipt: RemoteReceipt = (args, result) =>
  idReceipt(args, result) &&
  (present(nestedValue(result, ['url'])) || present(nestedValue(result, ['html_url'])));
const commentReplyReceipt: RemoteReceipt = (args, result) =>
  idUrlReceipt(args, result) ||
  fieldsReceipt(['comment', 'id'], ['comment', 'html_url'])(args, result) ||
  fieldsReceipt(['reaction', 'id'], ['reaction', 'url'])(args, result);
const branchReceipt = fieldsReceipt(['ref']);
const commitReceipt = fieldsReceipt(['commit', 'sha']);
const messageOrIdReceipt: RemoteReceipt = (args, result) =>
  messageReceipt(args, result) || idReceipt(args, result);

const actionRunReceipt: RemoteReceipt = (args, result) => {
  if (!record(result) || result.method !== args.method) return false;
  const field = {
    run_workflow: 'dispatch',
    rerun_workflow_run: 'rerun',
    rerun_failed_jobs: 'rerun_failed',
    cancel_workflow_run: 'cancel',
    delete_workflow_run_logs: 'delete_logs',
  }[String(args.method)];
  return field !== undefined && record(result[field]);
};

const issueWriteReceipt: RemoteReceipt = (args, result) =>
  record(result) &&
  result.method === args.method &&
  present(nestedValue(result, ['issue', 'id'])) &&
  present(nestedValue(result, ['issue', 'url']));

const issueCommentReceipt: RemoteReceipt = (_args, result) =>
  present(nestedValue(result, ['id'])) ||
  present(nestedValue(result, ['combined', 'comment', 'id'])) ||
  present(nestedValue(result, ['combined', 'reaction', 'id']));

const discussionCommentReceipt: RemoteReceipt = (args, result) =>
  messageOrIdReceipt(args, result) || fieldsReceipt(['discussionID'], ['discussionURL'])(args, result);

const artifactReceipt: RemoteReceipt = (args, result) => {
  if (!record(result)) return false;
  if (args.method === 'delete') {
    return record(result.deleted) && present(result.deleted.message);
  }
  return record(result.artifact) && present(result.artifact.id) &&
    (present(result.artifact.number) || present(result.artifact.name));
};

const dependencyReceipt: RemoteReceipt = (_args, result) =>
  record(result) && (
    messageReceipt({}, result) ||
    present(result.blocked_issue) ||
    present(result.blocking_issue)
  );

const projectWriteReceipt: RemoteReceipt = (args, result) => {
  if (!record(result) || result.method !== args.method) return false;
  return [
    'added', 'batch', 'deleted_item', 'deleted_view', 'issue_fields', 'item',
    'iteration_field', 'project', 'status_update', 'view',
  ].some(field => present(result[field]));
};

const mergeReceipt: RemoteReceipt = (_args, result) =>
  record(result) && result.merged === true &&
  (typeof result.sha === 'string' || typeof result.message === 'string');

const requestedReviewReceipt: RemoteReceipt = (_args, result) =>
  record(result) && result.status === 'requested';

const assignCopilotReceipt: RemoteReceipt = (_args, result) =>
  record(result) &&
  Number.isSafeInteger(Number(result.issue_number)) &&
  typeof result.message === 'string' && result.message.trim().length > 0;

const minimizedReceipt = (expected: boolean): RemoteReceipt =>
  (_args, result) => record(result) &&
    result.is_minimized === expected &&
    typeof result.node_id === 'string';

const automationRunReceipt: RemoteReceipt = (_args, result) =>
  record(result) && (
    present(result.id) || present(result.taskId) || present(result.task_id)
  );

const automationGroupReceipt: RemoteReceipt = (args, result) =>
  record(result) && (
    messageReceipt(args, result) ||
    present(result.id) || present(result.group_id) ||
    present(result.automation_id) && present(result.group_id)
  );

const alertReceipt: RemoteReceipt = (args, result) =>
  record(result) && String(result.number) === String(args.alertNumber) &&
  (args.state === undefined || result.state === args.state) &&
  (args.resolution === undefined || result.resolution === args.resolution);

const webTestReceipt: RemoteReceipt = (args, result) => {
  if (!record(result) || !record(result.webTest)) return false;
  const webTest = result.webTest;
  if (typeof webTest.resourceName !== 'string' ||
      webTest.resourceName.toLowerCase() !== String(args['webtest-resource']).toLowerCase() ||
      typeof webTest.resourceGroup !== 'string' ||
      webTest.resourceGroup.toLowerCase() !== String(args['resource-group']).toLowerCase() ||
      typeof webTest.id !== 'string') return false;
  if (args.enabled !== undefined && webTest.isEnabled !== args.enabled) return false;
  if (args.webtest !== undefined &&
      typeof webTest.webTestName === 'string' &&
      webTest.webTestName !== args.webtest) return false;
  const request = webTest.request;
  if (args['request-url'] !== undefined && record(request) &&
      typeof request.requestUrl === 'string' &&
      request.requestUrl !== args['request-url']) return false;
  return true;
};

type SpecOptions = Omit<RemoteActionSpec, 'operation' | 'identityFields' | 'receipt'>;

function action(
  operation: RemoteActionSpec['operation'],
  identityFields: readonly string[],
  receipt: RemoteReceipt,
  options: SpecOptions = {},
): RemoteActionSpec {
  return { operation, identityFields, receipt, ...options };
}

const selectorAction = (
  field: RemoteSelector['field'],
  choices: Readonly<Record<string, ToolCompletionOperation>>,
  identityFields: readonly string[],
  receipt: RemoteReceipt,
  options: Omit<SpecOptions, 'selector'> = {},
): RemoteActionSpec => ({
  ...action(args => choices[String(args[field] ?? '')] ?? 'generic', identityFields, receipt, options),
  selector: { field, choices },
});

function accepts(...operations: ToolCompletionOperation[]) {
  return () => operations;
}

export const githubActionSpecs: Readonly<Record<string, RemoteActionSpec>> = {
  add_automation_to_group: action('update', [
    ...repoIdentity, 'automation_id', 'group_id',
  ], automationGroupReceipt, {
    requestOperations: accepts('create', 'update'),
    resultIdentityFields: ['id', 'automation_id', 'group_id'],
  }),
  actions_run_trigger: selectorAction('method', {
    run_workflow: 'start',
    rerun_workflow_run: 'start',
    rerun_failed_jobs: 'start',
    cancel_workflow_run: 'delete',
    delete_workflow_run_logs: 'delete',
  }, [...repoIdentity, 'workflow_id', 'run_id', 'ref'], actionRunReceipt, {
    requiredIdentityFields: args => args.method === 'run_workflow'
      ? [...repoIdentity, 'workflow_id']
      : [...repoIdentity, 'run_id'],
  }),
  add_comment_to_pending_review: action('send', [...pullIdentity, 'path', 'line', 'startLine'], messageReceipt, {
    requestOperations: accepts('create', 'send'),
  }),
  add_issue_comment: action('send', [...issueIdentity, 'comment_id'], issueCommentReceipt, {
    requestOperations: accepts('create', 'send'),
    resultIdentityFields: ['id', 'html_url'],
    identityMatches: issueMatches,
  }),
  add_issue_comment_reaction: action('create', [...repoIdentity, 'comment_id'], idUrlReceipt, {
    resultIdentityFields: idUrlResult,
  }),
  add_issue_reaction: action('create', issueIdentity, idUrlReceipt, {
    resultIdentityFields: idUrlResult,
    identityMatches: issueMatches,
  }),
  add_pull_request_review_comment: action('send', [...pullIdentity, 'path', 'line', 'startLine'], messageReceipt, {
    requestOperations: accepts('create', 'send'),
  }),
  add_pull_request_review_comment_reaction: action('create', [...repoIdentity, 'comment_id'], idUrlReceipt, {
    resultIdentityFields: idUrlResult,
  }),
  add_reply_to_pull_request_comment: action('send', [...pullIdentity, 'commentId', 'comment_id'], commentReplyReceipt, {
    requestOperations: accepts('create', 'send'),
    resultIdentityFields: idUrlResult,
  }),
  add_sub_issue: action('update', [...issueIdentity, 'sub_issue_id'], fieldsReceipt(['issue'], ['method']), {
    requestOperations: accepts('create', 'update'),
    resultIdentityFields: ['issue', 'id', 'number'],
    identityMatches: issueMatches,
  }),
  assign_copilot_to_issue: action('start', issueIdentity, assignCopilotReceipt, {
    requestOperations: accepts('update', 'start'),
    resultIdentityFields: ['issue_number', 'issue_url'],
    identityMatches: issueMatches,
  }),
  assign_copilot_to_issue_with_intent: action(args =>
    args.is_suggestion === true ? 'update' : args.is_suggestion === false ? 'start' : 'generic',
  issueIdentity, assignCopilotReceipt, {
    requestOperations: args => args.is_suggestion === true
      ? ['update', 'create']
      : ['update', 'start'],
    resultIdentityFields: ['issue_number', 'issue_url'],
    identityMatches: issueMatches,
  }),
  create_automation: action('create', [...repoIdentity, 'name'], idReceipt, { resultIdentityFields: ['id'] }),
  create_automation_group: action('create', [...repoIdentity, 'name'], automationGroupReceipt, {
    resultIdentityFields: ['id', 'group_id', 'name'],
  }),
  create_branch: action('create', [...repoIdentity, 'branch', 'from_branch'], branchReceipt, {
    resultIdentityFields: ['ref'],
    identityMatches: [['branch', 'ref']],
  }),
  create_gist: action('create', ['filename'], idUrlReceipt, { resultIdentityFields: idUrlResult }),
  create_issue: action('create', repoIdentity, idUrlReceipt, { resultIdentityFields: idUrlResult }),
  create_or_update_file: action('update', [...repoIdentity, 'path', 'branch'], commitReceipt, {
    accepted: ['create', 'update'],
    resultIdentityFields: ['path', 'sha', 'commit', 'url', 'html_url'],
  }),
  create_pull_request: action('create', [...repoIdentity, 'head', 'base'], idReceipt, {
    resultIdentityFields: idUrlResult,
  }),
  create_pull_request_review: action('create', pullIdentity, messageReceipt),
  create_repository: action('create', ['organization', 'name'], idUrlReceipt, {
    resultIdentityFields: idUrlResult,
  }),
  create_repository_ruleset: action('create', ['level', 'owner', 'repo', 'org', 'enterprise', 'name'], idReceipt, {
    resultIdentityFields: ['id', 'name', 'source', 'target'],
  }),
  custom_properties_write: action('update', ['level', 'owner', 'repo', 'org', 'enterprise'], messageReceipt, {
    resultIdentityFields: ['level', 'method'],
  }),
  delete_automation: action('delete', [...repoIdentity, 'automation_id'], messageReceipt),
  delete_file: action('delete', [...repoIdentity, 'path', 'branch'], commitReceipt, {
    resultIdentityFields: ['path', 'commit', 'sha'],
  }),
  delete_pending_pull_request_review: action('delete', pullIdentity, messageReceipt),
  delete_repository: action('delete', repoIdentity, messageReceipt),
  discussion_comment_write: selectorAction('method', {
    add: 'send',
    reply: 'send',
    update: 'update',
    delete: 'delete',
    mark_answer: 'update',
    unmark_answer: 'update',
  }, [...repoIdentity, 'discussionNumber', 'discussion_number', 'commentNodeID', 'comment_node_id'], discussionCommentReceipt, {
    requiredIdentityFields: args => args.method === 'add'
      ? [...repoIdentity, 'discussionNumber']
      : args.method === 'reply'
        ? [...repoIdentity, 'discussionNumber', 'commentNodeID']
        : ['commentNodeID'],
    requestOperations: args => args.method === 'add'
      ? ['create', 'send']
      : args.method === 'delete'
        ? ['delete']
        : ['send', 'update'],
    resultIdentityFields: ['id', 'discussionID', 'discussionNumber', 'commentNodeID', 'message'],
    identityMatches: [
      ['discussionNumber', 'discussion_number'],
      ['commentNodeID', 'comment_node_id', 'id'],
    ],
  }),
  dismiss_notification: action('update', ['notificationID', 'threadID'], messageReceipt),
  fork_repository: action('create', [...repoIdentity, 'organization'], messageOrIdReceipt, {
    requestOperations: accepts('create', 'update'),
    resultIdentityFields: idUrlResult,
  }),
  hide_issue_comment: action('update', [...repoIdentity, 'comment_id'], minimizedReceipt(true), {
    resultIdentityFields: ['comment_id', 'node_id'],
  }),
  hide_pull_request_review: action('update', [...pullIdentity, 'review_id'], minimizedReceipt(true), {
    resultIdentityFields: ['review_id', 'node_id'],
  }),
  hide_pull_request_review_comment: action('update', [...repoIdentity, 'comment_id'], minimizedReceipt(true), {
    resultIdentityFields: ['comment_id', 'node_id'],
  }),
  issue_artifact_write: selectorAction('method', {
    create: 'create',
    update: 'update',
    delete: 'delete',
  }, [...issueIdentity, 'artifact_number'], artifactReceipt, {
    resultIdentityFields: ['artifact', 'artifact_number', 'id', 'number', 'issue_number'],
    identityMatches: [['artifact_number', 'number']],
  }),
  issue_dependency_write: selectorAction('method', {
    add: 'update',
    remove: 'update',
  }, [
    ...issueIdentity, 'related_issue_number', 'related_owner', 'related_repo',
  ], dependencyReceipt, {
    requestOperations: args => args.method === 'remove'
      ? ['delete', 'update']
      : ['create', 'update'],
    resultIdentityFields: ['blocked_issue', 'blocking_issue', 'issue', 'number'],
  }),
  issue_write: selectorAction('method', {
    create: 'create',
    update: 'update',
  }, issueIdentity, issueWriteReceipt, {
    requiredIdentityFields: args => args.method === 'update'
      ? [...issueIdentity]
      : [...repoIdentity],
    resultIdentityFields: ['issue', 'id', 'number', 'url'],
    identityMatches: issueMatches,
  }),
  label_write: selectorAction('method', {
    create: 'create',
    update: 'update',
    delete: 'delete',
  }, [...repoIdentity, 'name'], messageReceipt, {
    resultIdentityFields: ['name', 'method'],
  }),
  manage_notification_subscription: selectorAction('action', {
    ignore: 'update',
    watch: 'update',
    delete: 'delete',
  }, ['notificationID'], (args, result) =>
    messageReceipt(args, result) || present(nestedValue(result, ['subscription'])), {
    requestOperations: args => args.action === 'delete'
      ? ['delete', 'update']
      : ['create', 'update', 'start'],
  }),
  manage_repository_notification_subscription: selectorAction('action', {
    ignore: 'update',
    watch: 'update',
    delete: 'delete',
  }, repoIdentity, (args, result) =>
    messageReceipt(args, result) || present(nestedValue(result, ['subscription'])), {
    requestOperations: args => args.action === 'delete'
      ? ['delete', 'update']
      : ['create', 'update', 'start'],
  }),
  mark_all_notifications_read: action('update', [...repoIdentity], messageReceipt),
  merge_pull_request: action('update', [...pullIdentity, 'expectedHeadSha'], mergeReceipt, {
    resultIdentityFields: ['sha', 'message'],
  }),
  projects_write: selectorAction('method', {
    add_project_item: 'update',
    update_project_item: 'update',
    update_project_items: 'update',
    delete_project_item: 'delete',
    create_project_status_update: 'create',
    create_project_view: 'create',
    update_project_view: 'update',
    delete_project_view: 'delete',
    create_project: 'create',
    create_iteration_field: 'create',
  }, [
    'owner', 'owner_type', 'project_number', 'item_id', 'item_owner', 'item_repo',
    'issue_number', 'pull_request_number', 'view_id',
  ], projectWriteReceipt, {
    requestOperations: args => {
      const method = String(args.method);
      if (method === 'add_project_item') return ['create', 'update'];
      if (method === 'delete_project_item' || method === 'delete_project_view') {
        return ['delete', 'update'];
      }
      return [];
    },
    resultIdentityFields: [
      'id', 'item', 'project', 'view', 'item_id', 'project_number', 'view_id',
      'issue_number', 'pull_request_number',
    ],
    identityMatches: [],
  }),
  pull_request_artifact_write: selectorAction('method', {
    upsert: 'update',
    delete: 'delete',
  }, [...pullIdentity, 'name', 'name_key'], artifactReceipt, {
    requestOperations: args => args.method === 'delete'
      ? ['delete', 'update']
      : ['create', 'update'],
    resultIdentityFields: ['artifact', 'id', 'name', 'number'],
    identityMatches: [],
  }),
  pull_request_review_write: selectorAction('method', {
    create: 'create',
    submit_pending: 'send',
    delete_pending: 'delete',
    resolve_thread: 'update',
    unresolve_thread: 'update',
  }, [...pullIdentity, 'threadId', 'thread_id'], messageReceipt, {
    requiredIdentityFields: args =>
      args.method === 'resolve_thread' || args.method === 'unresolve_thread'
        ? ['threadId']
        : pullIdentity,
  }),
  push_files: action('update', [...repoIdentity, 'branch'], branchReceipt, {
    accepted: ['create', 'update'],
    identityFiles: true,
    resultIdentityFields: ['ref', 'sha', 'commit'],
    identityMatches: [['branch', 'ref']],
  }),
  remove_issue_comment_reaction: action('delete', [...repoIdentity, 'comment_id', 'reaction_id'], messageReceipt),
  remove_issue_reaction: action('delete', [...issueIdentity, 'reaction_id'], messageReceipt),
  remove_pull_request_review_comment_reaction: action('delete', [...repoIdentity, 'comment_id', 'reaction_id'], messageReceipt),
  remove_automation_from_group: action('update', [
    ...repoIdentity, 'automation_id', 'group_id',
  ], automationGroupReceipt, {
    requestOperations: accepts('delete', 'update'),
    resultIdentityFields: ['id', 'automation_id', 'group_id'],
  }),
  remove_sub_issue: action('update', [...issueIdentity, 'sub_issue_id'], fieldsReceipt(['issue'], ['method']), {
    requestOperations: accepts('delete', 'update'),
    identityMatches: issueMatches,
  }),
  reprioritize_sub_issue: action('update', [
    ...issueIdentity, 'sub_issue_id', 'after_id', 'before_id',
  ], fieldsReceipt(['issue'], ['method']), {
    identityMatches: issueMatches,
  }),
  request_copilot_review: action('update', pullIdentity, requestedReviewReceipt, {
    identityMatches: pullMatches,
  }),
  request_pull_request_reviewers: action('update', pullIdentity, idUrlReceipt, {
    requestOperations: accepts('send', 'update', 'start'),
    resultIdentityFields: idUrlResult,
    identityMatches: pullMatches,
  }),
  resolve_review_thread: action('update', ['threadID'], messageReceipt),
  run_automation: action('start', [...repoIdentity, 'automation_id'], automationRunReceipt, {
    resultIdentityFields: ['id', 'taskId', 'task_id'],
  }),
  set_issue_fields: action('update', issueIdentity, idUrlReceipt, {
    resultIdentityFields: idUrlResult,
    identityMatches: issueMatches,
  }),
  star_repository: action('update', repoIdentity, messageReceipt),
  sub_issue_write: selectorAction('method', {
    add: 'update',
    remove: 'update',
    reprioritize: 'update',
  }, [...issueIdentity, 'sub_issue_id', 'after_id', 'before_id'], fieldsReceipt(['issue'], ['method']), {
    requestOperations: args => args.method === 'add'
      ? ['create', 'update']
      : args.method === 'remove'
        ? ['delete', 'update']
        : ['update'],
    identityMatches: issueMatches,
  }),
  submit_pending_pull_request_review: action('send', pullIdentity, messageReceipt),
  unhide_issue_comment: action('update', [...repoIdentity, 'comment_id'], minimizedReceipt(false), {
    resultIdentityFields: ['comment_id', 'node_id'],
  }),
  unhide_pull_request_review: action('update', [...pullIdentity, 'review_id'], minimizedReceipt(false), {
    resultIdentityFields: ['review_id', 'node_id'],
  }),
  unhide_pull_request_review_comment: action('update', [...repoIdentity, 'comment_id'], minimizedReceipt(false), {
    resultIdentityFields: ['comment_id', 'node_id'],
  }),
  unresolve_review_thread: action('update', ['threadID'], messageReceipt),
  unstar_repository: action('update', repoIdentity, messageReceipt),
  update_automation: action('update', [...repoIdentity, 'automation_id'], idReceipt, {
    resultIdentityFields: ['id'],
    identityMatches: [['automation_id', 'id']],
  }),
  update_code_scanning_alert: action('update', [...repoIdentity, 'alertNumber'], alertReceipt, {
    resultIdentityFields: ['number', 'state', 'html_url'],
    identityMatches: [['alertNumber', 'number']],
  }),
  update_dependabot_alert: action('update', [...repoIdentity, 'alertNumber'], alertReceipt, {
    resultIdentityFields: ['number', 'state', 'html_url'],
    identityMatches: [['alertNumber', 'number']],
  }),
  update_gist: action('update', ['gist_id', 'filename'], idUrlReceipt, {
    resultIdentityFields: idUrlResult,
    identityMatches: [['gist_id', 'id']],
  }),
  update_issue_assignees: action('update', issueIdentity, idUrlReceipt, {
    resultIdentityFields: idUrlResult,
    identityMatches: issueMatches,
  }),
  update_issue_body: action('update', issueIdentity, idUrlReceipt, {
    resultIdentityFields: idUrlResult,
    identityMatches: issueMatches,
  }),
  update_issue_comment: action('update', [...repoIdentity, 'comment_id'], idUrlReceipt, {
    resultIdentityFields: idUrlResult,
    identityMatches: [['comment_id', 'id']],
  }),
  update_issue_labels: action('update', issueIdentity, idUrlReceipt, {
    resultIdentityFields: idUrlResult,
    identityMatches: issueMatches,
  }),
  update_issue_milestone: action('update', issueIdentity, idUrlReceipt, {
    resultIdentityFields: idUrlResult,
    identityMatches: issueMatches,
  }),
  update_issue_state: action('update', issueIdentity, idUrlReceipt, {
    requestOperations: accepts('delete', 'update'),
    resultIdentityFields: idUrlResult,
    identityMatches: issueMatches,
  }),
  update_issue_title: action('update', issueIdentity, idUrlReceipt, {
    resultIdentityFields: idUrlResult,
    identityMatches: issueMatches,
  }),
  update_issue_type: action('update', issueIdentity, idUrlReceipt, {
    resultIdentityFields: idUrlResult,
    identityMatches: issueMatches,
  }),
  update_pull_request: action('update', pullIdentity, idReceipt, {
    resultIdentityFields: idUrlResult,
    identityMatches: pullMatches,
  }),
  update_pull_request_body: action('update', pullIdentity, idUrlReceipt, {
    resultIdentityFields: idUrlResult,
    identityMatches: pullMatches,
  }),
  update_pull_request_branch: action('update', [...pullIdentity, 'expectedHeadSha'], messageReceipt),
  update_pull_request_draft_state: action('update', pullIdentity, messageReceipt),
  update_pull_request_state: action('update', pullIdentity, idUrlReceipt, {
    requestOperations: accepts('delete', 'update'),
    resultIdentityFields: idUrlResult,
    identityMatches: pullMatches,
  }),
  update_pull_request_title: action('update', pullIdentity, idUrlReceipt, {
    resultIdentityFields: idUrlResult,
    identityMatches: pullMatches,
  }),
  update_secret_scanning_alert: action('update', [...repoIdentity, 'alertNumber'], alertReceipt, {
    resultIdentityFields: ['number', 'state', 'resolution', 'validity'],
    identityMatches: [['alertNumber', 'number']],
  }),
} as const;

export const azureActionSpecs: Readonly<Record<string, RemoteActionSpec>> = {
  monitor_webtests_createorupdate: action('update', [
    'subscription', 'resource-group', 'webtest-resource',
  ], webTestReceipt, {
    accepted: ['create', 'update'],
    resultIdentityFields: ['id', 'resourceGroup', 'resourceName'],
    identityMatches: [
      ['resource-group', 'resourceGroup'],
      ['webtest-resource', 'resourceName'],
    ],
  }),
};

export const githubActionNames = Object.freeze(Object.keys(githubActionSpecs));
export const azureActionNames = Object.freeze(Object.keys(azureActionSpecs));
