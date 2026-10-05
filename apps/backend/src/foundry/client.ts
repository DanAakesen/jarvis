/// <reference types="node" />

/** The backend's managed-identity credential supplies this scope; never use the CLI here. */
export const FOUNDRY_SCOPE = "https://ai.azure.com/.default";

export type CodingAgent = "codex" | "copilot";
export type InvocationStatus =
  | "queued" | "running" | "completed" | "failed" | "cancelled" | "needs_attention"
  | "cancelling" | "interrupted" | "paused" | "unknown";
export type JsonObject = { [key: string]: unknown };
export type FoundryErrorKind = "http" | "auth" | "timeout" | "aborted" | "transport" | "protocol";

/** Contains only controlled diagnostics, never provider bodies, prompts, tokens or URLs. */
export class FoundryClientError extends Error {
  constructor(
    public readonly kind: FoundryErrorKind,
    public readonly operation: string,
    public readonly statusCode: number | undefined = undefined,
  ) {
    super(`Foundry ${operation}: ${kind}${statusCode === undefined ? "" : ` (${statusCode})`}`);
    this.name = "FoundryClientError";
  }
}

export interface FoundryClientOptions {
  runtimeEndpoint: string;
  adminEndpoint: string;
  agentName: string;
  apiVersion?: string;
  /** Own credential caching in the supplied identity provider, outside this client. */
  getToken: (scope: string, signal: AbortSignal) => Promise<string>;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

export interface RequestOptions { signal?: AbortSignal; onResponse?: (statusCode: number) => void }
/** Effective task configuration; the dispatcher resolves overrides before settings defaults. */
export interface TaskWorkspace {
  repository: string;
  defaultBranch: string;
  branch: string;
}
export type TaskRequest = TaskWorkspace & (
  | { agent: "copilot"; task: string; taskId?: string; model?: string }
  | { agent: "codex"; task: string; taskId?: string; model?: string; reasoning?: string });
export interface InvocationAccepted {
  invocationId: string;
  sessionId: string;
  status: InvocationStatus;
  agent: CodingAgent;
}
export interface PauseAcknowledgement {
  sessionId: string;
  status: "pausing" | "idle";
  pausedInvocationId: string | null;
}
export interface InvocationEvent { at: number; kind: string; data: JsonObject }
export interface InvocationSnapshot extends InvocationAccepted {
  startedAt: number;
  finishedAt: number | null;
  events: InvocationEvent[];
  result: JsonObject | null;
  error: string | null;
}
export interface CancelAcknowledgement { invocationId: string; status: InvocationStatus }

const STATUSES = new Set<unknown>([
  "queued", "running", "completed", "failed", "cancelled", "needs_attention",
  "cancelling", "interrupted", "paused", "unknown",
]);

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value === "." || value === ".." || value.length > 256 ||
      [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new TypeError(`${name} must be a nonempty identifier of at most 256 characters`);
  }
  return value;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 65_536) {
    throw new TypeError(`${name} must contain 1–65536 characters`);
  }
  return value;
}

function option(value: unknown, name: string, limit: number): string | undefined {
  if (value === undefined || value === "default") return undefined;
  if (typeof value !== "string" || !value.trim() || value.trimStart().startsWith("-") || value.length > limit ||
      [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new TypeError(`${name} must be a valid option of at most ${limit} characters`);
  }
  return value;
}

function taskBody(request: TaskRequest): JsonObject {
  const model = option(request.model, "model", 100);
  const reasoning = request.agent === "codex" ? option(request.reasoning, "reasoning", 32) : undefined;
  const taskId = taskIdentifier(request.taskId);
  const workspaceInput = request as Partial<TaskWorkspace>;
  if (workspaceInput.repository === undefined || workspaceInput.defaultBranch === undefined ||
      workspaceInput.branch === undefined) {
    throw new TypeError("repository, defaultBranch and branch must be provided together");
  }
  const repositoryName = repository(workspaceInput.repository);
  const defaultBranch = branch(workspaceInput.defaultBranch, "defaultBranch");
  const taskBranch = branch(workspaceInput.branch, "branch");
  if (taskBranch === defaultBranch || taskBranch === "main" || taskBranch === "master") {
    throw new TypeError("branch must be a separate task branch");
  }
  return {
    agent: agent(request.agent),
    task: text(request.task, "task"),
    repository: repositoryName,
    defaultBranch,
    branch: taskBranch,
    ...(taskId === undefined ? {} : { task_id: taskId }),
    ...(model === undefined ? {} : { model }),
    ...(reasoning === undefined ? {} : { reasoning }),
  };
}

function repository(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim() || value.length > 140 ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/u.test(value) ||
      value.split("/")[1] === "." || value.split("/")[1] === "..") {
    throw new TypeError("repository must be a GitHub owner/name");
  }
  return value;
}

function branch(value: unknown, name: string): string {
  if (typeof value !== "string" || !value || value.length > 255 || value === "HEAD" ||
      value.startsWith("-") || /[\s~^:?*[\]\\]/u.test(value) ||
      [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
      value.includes("..") || value.includes("@{") || value.endsWith(".") ||
      value.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))) {
    throw new TypeError(`${name} must be a valid Git branch`);
  }
  return value;
}

function taskIdentifier(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/u.test(value) ||
      BigInt(value) > 9_223_372_036_854_775_807n) {
    throw new TypeError("taskId must be a positive SQL bigint identifier");
  }
  return value;
}

function agent(value: unknown): CodingAgent {
  if (value !== "codex" && value !== "copilot") throw new TypeError("agent must be codex or copilot");
  return value;
}

function endpoint(value: string, hostSuffix: string, name: string): string {
  let url: URL;
  try { url = new URL(value) } catch { throw new TypeError(`${name} must be a valid Foundry project endpoint`) }
  if (url.protocol !== "https:" || !url.hostname.endsWith(hostSuffix) || url.port ||
      url.username || url.password || url.search || url.hash ||
      !/^\/api\/projects\/[^/]+\/?$/u.test(url.pathname)) {
    throw new TypeError(`${name} must be an HTTPS Foundry project endpoint on ${hostSuffix}`);
  }
  return url.href.replace(/\/$/u, "");
}

function positiveInteger(value: number, name: string, limit: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > limit) {
    throw new TypeError(`${name} must be a positive integer no greater than ${limit}`);
  }
  return value;
}

function wireString(value: unknown): value is string { return typeof value === "string" && value.length > 0 }
function wireAgent(value: unknown): value is CodingAgent { return value === "codex" || value === "copilot" }
function timestamp(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 }

/** One bounded HTTP call per operation. Retry/state/heartbeat policy belongs to the dispatcher. */
export class FoundryClient {
  private readonly runtime: string;
  private readonly admin: string;
  private readonly agentName: string;
  private readonly apiVersion: string;
  private readonly getToken: FoundryClientOptions["getToken"];
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(options: FoundryClientOptions) {
    this.runtime = endpoint(options.runtimeEndpoint, ".cognitiveservices.azure.com", "runtimeEndpoint");
    this.admin = endpoint(options.adminEndpoint, ".services.ai.azure.com", "adminEndpoint");
    const runtime = new URL(this.runtime);
    const admin = new URL(this.admin);
    if (runtime.hostname.replace(".cognitiveservices.azure.com", "") !== admin.hostname.replace(".services.ai.azure.com", "") ||
        runtime.pathname !== admin.pathname) {
      throw new TypeError("Foundry endpoints must identify the same account and project");
    }
    this.agentName = identifier(options.agentName, "agentName");
    this.apiVersion = identifier(options.apiVersion ?? "v1", "apiVersion");
    this.getToken = options.getToken;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = positiveInteger(options.requestTimeoutMs ?? 30_000, "requestTimeoutMs", 120_000);
    this.maxBytes = positiveInteger(options.maxResponseBytes ?? 1_048_576, "maxResponseBytes", 16_777_216);
  }

  async startTask(request: TaskRequest, options: RequestOptions = {}): Promise<InvocationAccepted> {
    const body = await this.runtimeRequest("start", "protocols/invocations", "POST", {
      ...taskBody(request),
    }, undefined, options);
    return this.accepted(body, "start", undefined, request.agent);
  }

  async startCodexRenewal(options: RequestOptions = {}): Promise<InvocationAccepted> {
    const body = await this.runtimeRequest("renew-codex", "protocols/invocations", "POST", {
      agent: "codex", mode: "renew-codex", min_days_left: 3,
    }, undefined, options);
    return this.accepted(body, "renew-codex", undefined, "codex");
  }

  async steer(
    sessionId: string,
    codingAgent: CodingAgent,
    message: string,
    options: RequestOptions & { taskId?: string } = {},
  ): Promise<InvocationAccepted> {
    const taskId = taskIdentifier(options.taskId);
    const body = await this.runtimeRequest("steer", "protocols/invocations", "POST", {
      agent: agent(codingAgent), mode: "steer", message: text(message, "message"),
      ...(taskId === undefined ? {} : { task_id: taskId }),
    }, identifier(sessionId, "sessionId"), options);
    return this.accepted(body, "steer", sessionId, codingAgent);
  }

  async pause(sessionId: string, options: RequestOptions = {}): Promise<PauseAcknowledgement> {
    const body = await this.runtimeRequest("pause", "protocols/invocations", "POST", { mode: "pause" }, identifier(sessionId, "sessionId"), options);
    if (!object(body) || body["session_id"] !== sessionId ||
        (body["status"] !== "pausing" && body["status"] !== "idle") ||
        !(body["paused_invocation"] === null || wireString(body["paused_invocation"]))) throw this.protocol("pause");
    return { sessionId, status: body["status"], pausedInvocationId: body["paused_invocation"] };
  }

  /** Caller uses this only after a clean pause/idle shutdown; crash recovery starts a new session. */
  async resume(sessionId: string, request: TaskRequest, options: RequestOptions = {}): Promise<InvocationAccepted> {
    const body = await this.runtimeRequest("resume", "protocols/invocations", "POST", {
      ...taskBody(request),
    }, identifier(sessionId, "sessionId"), options);
    return this.accepted(body, "resume", sessionId, request.agent);
  }

  async cancel(invocationId: string, options: RequestOptions = {}): Promise<CancelAcknowledgement> {
    const body = await this.runtimeRequest("cancel", `protocols/invocations/${encodeURIComponent(identifier(invocationId, "invocationId"))}/cancel`, "POST", undefined, undefined, options);
    if (!object(body) || body["invocation_id"] !== invocationId || !STATUSES.has(body["status"])) throw this.protocol("cancel");
    return { invocationId, status: body["status"] as InvocationStatus };
  }

  /** Provider completion is an observation; delivery still requires GitHub branch/PR evidence. */
  async status(invocationId: string, options: RequestOptions = {}): Promise<InvocationSnapshot> {
    const body = await this.runtimeRequest("status", `protocols/invocations/${encodeURIComponent(identifier(invocationId, "invocationId"))}`, "GET", undefined, undefined, options);
    const accepted = this.accepted(body, "status");
    if (!object(body) || accepted.invocationId !== invocationId || !timestamp(body["started_at"]) ||
        !(body["finished_at"] === null || timestamp(body["finished_at"])) ||
        !Array.isArray(body["events"]) || body["events"].length > 10_000 ||
        !(body["result"] === null || object(body["result"])) ||
        !(body["error"] === null || typeof body["error"] === "string")) throw this.protocol("status");
    const events = body["events"].map((event: unknown): InvocationEvent => {
      if (!object(event) || !timestamp(event["at"]) || !wireString(event["kind"]) || !object(event["data"])) throw this.protocol("status");
      return { at: event["at"], kind: event["kind"], data: event["data"] };
    });
    return { ...accepted, startedAt: body["started_at"], finishedAt: body["finished_at"], events, result: body["result"], error: body["error"] };
  }

  /** Session owner explicitly deletes after delivery/cancel, or in a probe's finally block (L14). */
  async deleteSession(sessionId: string, options: RequestOptions = {}): Promise<void> {
    await this.runtimeRequest("delete-session", `sessions/${encodeURIComponent(identifier(sessionId, "sessionId"))}`, "DELETE", undefined, undefined, options, true);
  }

  /** Administration must never be sent to the session runtime host (L1/L10). Creates no session. */
  async checkAdministration(options: RequestOptions = {}): Promise<void> {
    for (const path of ["connections", `agents/${encodeURIComponent(this.agentName)}/versions`]) {
      const body = await this.request("administration", this.url(this.admin, path), "GET", undefined, options);
      if (!object(body)) throw this.protocol("administration");
    }
  }

  private accepted(body: unknown, operation: string, expectedSession?: string, expectedAgent?: CodingAgent): InvocationAccepted {
    if (!object(body) || !wireString(body["invocation_id"]) || !wireString(body["session_id"]) ||
        !STATUSES.has(body["status"]) || !wireAgent(body["agent"]) ||
        (expectedSession !== undefined && body["session_id"] !== expectedSession) ||
        (expectedAgent !== undefined && body["agent"] !== expectedAgent)) throw this.protocol(operation);
    return { invocationId: body["invocation_id"], sessionId: body["session_id"], status: body["status"] as InvocationStatus, agent: body["agent"] };
  }

  private protocol(operation: string): FoundryClientError { return new FoundryClientError("protocol", operation) }

  private url(base: string, path: string, sessionId?: string): string {
    const url = new URL(`${base}/${path}`);
    url.searchParams.set("api-version", this.apiVersion);
    if (sessionId !== undefined) url.searchParams.set("agent_session_id", sessionId);
    return url.href;
  }

  private runtimeRequest(operation: string, path: string, method: string, body: JsonObject | undefined, sessionId: string | undefined, options: RequestOptions, ignoreBody = false): Promise<unknown> {
    return this.request(operation, this.url(`${this.runtime}/agents/${encodeURIComponent(this.agentName)}/endpoint`, path, sessionId), method, body, options, ignoreBody);
  }

  private async request(operation: string, url: string, method: string, body: JsonObject | undefined, options: RequestOptions, ignoreBody = false): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.timeoutMs);
    let phase: "auth" | "transport" = "auth";
    let rejectAbort: (() => void) | undefined;
    try {
      controller.signal.throwIfAborted();
      const cancelled = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new FoundryClientError(timedOut ? "timeout" : "aborted", operation));
        controller.signal.addEventListener("abort", rejectAbort, { once: true });
      });
      return await Promise.race([cancelled, (async () => {
        const token = await this.getToken(FOUNDRY_SCOPE, controller.signal);
        if (typeof token !== "string" || !token.trim() || /[\r\n]/u.test(token)) throw new FoundryClientError("auth", operation);
        controller.signal.throwIfAborted();
        phase = "transport";
        const response = await this.fetch(url, {
          method, signal: controller.signal, redirect: "error",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (response.redirected) { await response.body?.cancel().catch(() => undefined); throw this.protocol(operation) }
        options.onResponse?.(response.status);
        if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new FoundryClientError("http", operation, response.status) }
        const content = await this.readBody(response, operation, controller.signal);
        if (ignoreBody) return undefined;
        try { return JSON.parse(content) as unknown } catch { throw this.protocol(operation) }
      })()]);
    } catch (error) {
      if (controller.signal.aborted) throw new FoundryClientError(timedOut ? "timeout" : "aborted", operation);
      if (error instanceof FoundryClientError) throw error;
      throw new FoundryClientError(phase, operation);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
    }
  }

  private async readBody(response: Response, operation: string, signal: AbortSignal): Promise<string> {
    if (Number(response.headers.get("content-length")) > this.maxBytes) {
      await response.body?.cancel();
      throw this.protocol(operation);
    }
    if (!response.body) return "";
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => undefined) };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { signal.throwIfAborted(); break }
        size += value.byteLength;
        if (size > this.maxBytes) throw this.protocol(operation);
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally { signal.removeEventListener("abort", cancel); reader.releaseLock() }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder().decode(bytes);
  }
}
