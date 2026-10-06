import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoundryClient, FoundryClientError, FOUNDRY_SCOPE } from "./client.js";

const recording = JSON.parse(readFileSync(new URL("./fixtures/runner-responses.json", import.meta.url), "utf8")) as { records: Record<string, { status_code: number; body: unknown; request?: Record<string, unknown> }> };
const fixtures = Object.fromEntries(Object.entries(recording.records).map(([name, record]) => [name, record.body]));
const runtimeEndpoint = "https://example.cognitiveservices.azure.com/api/projects/jarvis";
const adminEndpoint = "https://example.services.ai.azure.com/api/projects/jarvis";
const token = "test-only-credential";
const workspace = { repository: "DanAakesen/jarvis", defaultBranch: "main", branch: "jarvis/task-42" };

function setup(body: unknown = fixtures["task_start"], status = 200, extra = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
    status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status }),
  );
  const getToken = vi.fn(async () => token);
  const client = new FoundryClient({ runtimeEndpoint, adminEndpoint, agentName: "jarvis-runner", getToken, fetch, ...extra });
  return { client, fetch, getToken };
}

function request(fetch: ReturnType<typeof setup>["fetch"], call = 0) {
  const [url, init] = fetch.mock.calls[call]!;
  return { url: new URL(String(url)), init: init!, body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined };
}

afterEach(() => { vi.useRealTimers() });

describe("Foundry runner wire contract", () => {
  it.each(["task_start", "resume"])("records required workspace fields accepted by the runner: %s", (name) => {
    expect(recording.records[name]?.status_code).toBe(200);
    expect(recording.records[name]?.request).toMatchObject(workspace);
  });
  it.each([
    { repository: undefined }, { repository: "https://github.com/owner/repo" },
    { repository: "owner/../repo" }, { defaultBranch: undefined },
    { defaultBranch: "main;command " }, { branch: undefined },
    { branch: "-option" }, { branch: "refs/../main" }, { branch: "topic.lock" },
    { branch: "topic\nname" }, { branch: "a//b" },
    { branch: "HEAD" }, { branch: "main" }, { branch: "master" },
    { branch: "develop", defaultBranch: "develop" },
    { repository: `${"a".repeat(40)}/repo` }, { repository: `owner/${"a".repeat(101)}` },
    { defaultBranch: "main\n" }, { branch: "topic\u0000name" },
  ])("rejects invalid required workspace fields before network calls: %j", async (invalid) => {
    const { client, fetch, getToken } = setup();
    await expect(client.startTask({
      ...workspace, agent: "copilot", task: "Work", ...invalid,
    } as Parameters<FoundryClient["startTask"]>[0])).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });

  it.each(["release/æøå", "release/v1+patch", "release/ready;next", "foo./bar", "@"])("preserves Git-valid default branch %s", async (defaultBranch) => {
    const { client, fetch } = setup();
    await client.startTask({ ...workspace, defaultBranch, agent: "copilot", task: "Work" });
    expect(request(fetch).body).toMatchObject({ defaultBranch });
  });

  it("starts a new session with the recorded task body and identity scope", async () => {
    const { client, fetch, getToken } = setup();
    const accepted = await client.startTask({ ...workspace, agent: "copilot", task: "Implement issue #30" });
    expect(accepted).toEqual({ invocationId: "capture-task", sessionId: "capture-session", status: "queued", agent: "copilot" });
    const sent = request(fetch);
    expect(sent.url.href).toBe(`${runtimeEndpoint}/agents/jarvis-runner/endpoint/protocols/invocations?api-version=v1`);
    expect(sent.body).toEqual({ ...workspace, agent: "copilot", task: "Implement issue #30" });
    expect(sent.init).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" } });
    expect(getToken).toHaveBeenCalledWith(FOUNDRY_SCOPE, expect.any(AbortSignal));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("starts a Codex renewal invocation with the three-day threshold", async () => {
    const { client, fetch } = setup({ ...(fixtures["task_start"] as object), agent: "codex", mode: "renew-codex" });
    const accepted = await client.startCodexRenewal();
    expect(accepted.agent).toBe("codex");
    expect(request(fetch).body).toEqual({ agent: "codex", mode: "renew-codex", min_days_left: 3 });
  });

  it("passes force=true for a manual Codex renewal", async () => {
    const { client, fetch } = setup({ ...(fixtures["task_start"] as object), agent: "codex", mode: "renew-codex" });
    await client.startCodexRenewal({ force: true });
    expect(request(fetch).body).toEqual({ agent: "codex", mode: "renew-codex", min_days_left: 3, force: true });
  });

  it("starts a Codex tool invocation without repository workspace fields", async () => {
    const { client, fetch } = setup({
      ...(fixtures["task_start"] as object), agent: "codex", mode: "codex-tool",
    });
    const accepted = await client.startCodexTool({
      task: "A quiet sea at sunrise",
      artifactUploadKey: "a".repeat(43),
      model: "gpt-5.5",
    });
    expect(accepted.agent).toBe("codex");
    expect(request(fetch).body).toEqual({
      agent: "codex",
      mode: "codex-tool",
      task: "A quiet sea at sunrise",
      artifact_upload_key: "a".repeat(43),
      model: "gpt-5.5",
    });
    expect(request(fetch).body).not.toHaveProperty("repository");
  });

  it("rejects oversized Codex tool prompts and malformed upload keys before network calls", async () => {
    const { client, fetch } = setup();
    await expect(client.startCodexTool({
      task: "x".repeat(4097), artifactUploadKey: "a".repeat(43),
    })).rejects.toBeInstanceOf(TypeError);
    await expect(client.startCodexTool({
      task: "Draw", artifactUploadKey: "not-a-key",
    })).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("starts an isolated Codex web research tool invocation", async () => {
    const { client, fetch } = setup({ ...(fixtures["task_start"] as object), agent: "codex" });
    const query = "Research this safely; do not run $(commands)";
    const accepted = await client.startCodexTool("web_research", query, "gpt-5.5");
    expect(accepted.agent).toBe("codex");
    expect(request(fetch).body).toEqual({
      agent: "codex", mode: "codex-tool", tool: "web_research", query, model: "gpt-5.5",
    });
  });

  it.each([
    ["unsupported tool", "shell" as never, "query", "gpt-5.5"],
    ["empty query", "web_research", " ", "gpt-5.5"],
    ["oversized query", "web_research", "q".repeat(2_001), "gpt-5.5"],
    ["rejected subscription model", "web_research", "query", "gpt-6.1-sol"],
  ])("rejects invalid Codex tool request: %s", async (_name, tool, query, model) => {
    const { client, fetch, getToken } = setup();
    await expect(client.startCodexTool(tool, query, model)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });

  it("passes effective model and Codex reasoning to new runner sessions", async () => {
    const { client, fetch } = setup({ ...(fixtures["task_start"] as object), agent: "codex" });
    await client.startTask({
      ...workspace, agent: "codex", task: "Implement issue #37", model: "gpt-5.4", reasoning: "high",
    });
    expect(request(fetch).body).toEqual({
      ...workspace, agent: "codex", task: "Implement issue #37", model: "gpt-5.4", reasoning: "high",
    });
  });

  it("passes the SQL task ID for runner event attribution", async () => {
    const { client, fetch } = setup();
    await client.startTask({ ...workspace, agent: "copilot", task: "Work", taskId: "42" });
    expect(request(fetch).body).toEqual({ ...workspace, agent: "copilot", task: "Work", task_id: "42" });
    await expect(client.startTask({ ...workspace, agent: "copilot", task: "Work", taskId: "9223372036854775808" }))
      .rejects.toBeInstanceOf(TypeError);
  });

  it("omits provider defaults and reasoning for Copilot", async () => {
    const { client, fetch } = setup();
    await client.startTask({ ...workspace, agent: "copilot", task: "Work", model: "default" });
    expect(request(fetch).body).toEqual({ ...workspace, agent: "copilot", task: "Work" });
  });

  it("steers the existing session through runner mode=steer", async () => {
    const { client, fetch } = setup(fixtures["steer"]);
    const accepted = await client.steer("capture-session", "copilot", "Change the requirement");
    expect(accepted.invocationId).toBe("capture-steer");
    expect(request(fetch).url.searchParams.get("agent_session_id")).toBe("capture-session");
    expect(request(fetch).body).toEqual({ agent: "copilot", mode: "steer", message: "Change the requirement" });
  });

  it("keeps the task ID when a steer starts a new runner invocation", async () => {
    const { client, fetch } = setup(fixtures["steer"]);
    await client.steer("capture-session", "copilot", "Change the requirement", { taskId: "42" });
    expect(request(fetch).body).toEqual({
      agent: "copilot", mode: "steer", message: "Change the requirement", task_id: "42",
    });
  });

  it.each(["pause_active", "pause_idle"])("preserves %s acknowledgement without declaring the turn paused", async (fixture) => {
    const { client, fetch } = setup(fixtures[fixture]);
    const result = await client.pause("capture-session");
    expect(result).toEqual(fixture === "pause_active"
      ? { sessionId: "capture-session", status: "pausing", pausedInvocationId: "capture-task" }
      : { sessionId: "capture-session", status: "idle", pausedInvocationId: null });
    expect(request(fetch).body).toEqual({ mode: "pause" });
    expect(request(fetch).url.searchParams.get("agent_session_id")).toBe("capture-session");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("resumes cleanly paused work on the same session without a made-up resume mode", async () => {
    const { client, fetch } = setup(fixtures["resume"]);
    expect((await client.resume("capture-session", { ...workspace, agent: "copilot", task: "Continue" })).sessionId).toBe("capture-session");
    expect(request(fetch).body).toEqual({ ...workspace, agent: "copilot", task: "Continue" });
    expect(request(fetch).url.searchParams.get("agent_session_id")).toBe("capture-session");
  });

  it("passes the task ID when resuming runner events", async () => {
    const { client, fetch } = setup(fixtures["resume"]);
    await client.resume("capture-session", { ...workspace, agent: "copilot", task: "Continue", taskId: "42" });
    expect(request(fetch).body).toEqual({ ...workspace, agent: "copilot", task: "Continue", task_id: "42" });
  });

  it("forwards Codex model and reasoning when resuming", async () => {
    const { client, fetch } = setup({ ...(fixtures["resume"] as object), agent: "codex" });
    await client.resume("capture-session", {
      ...workspace, agent: "codex", task: "Continue", model: "gpt-5.4", reasoning: "high",
    });
    expect(request(fetch).body).toEqual({
      ...workspace, agent: "codex", task: "Continue", model: "gpt-5.4", reasoning: "high",
    });
  });

  it("forwards the task repository and branch workspace when starting a task", async () => {
    const { client, fetch } = setup(fixtures["task_start"]);
    await client.startTask({
      agent: "copilot",
      task: "Continue from the task branch",
      repository: "DanAakesen/jarvis",
      defaultBranch: "main",
      branch: "jarvis/task-42",
    });
    expect(request(fetch).body).toEqual({
      agent: "copilot",
      task: "Continue from the task branch",
      repository: "DanAakesen/jarvis",
      defaultBranch: "main",
      branch: "jarvis/task-42",
    });
  });

  it("rejects incomplete or unsafe task workspaces before sending a request", async () => {
    const { client, fetch } = setup(fixtures["task_start"]);
    await expect(client.startTask({
      agent: "copilot", task: "Recover", repository: "DanAakesen/jarvis",
    })).rejects.toThrow("must be provided together");
    await expect(client.startTask({
      agent: "copilot", task: "Recover", repository: "DanAakesen/jarvis",
      defaultBranch: "main", branch: "main",
    })).rejects.toThrow("separate task branch");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels only the requested invocation without deleting the session", async () => {
    const { client, fetch } = setup(fixtures["cancel"]);
    expect(await client.cancel("capture-task")).toEqual({ invocationId: "capture-task", status: "cancelled" });
    expect(request(fetch).url.pathname).toBe("/api/projects/jarvis/agents/jarvis-runner/endpoint/protocols/invocations/capture-task/cancel");
    expect(request(fetch).init.method).toBe("POST");
    expect(request(fetch).body).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns events, timestamps and nullable result/error for healthy status", async () => {
    const { client, fetch } = setup(fixtures["status_running"]);
    expect(await client.status("capture-task")).toEqual({
      invocationId: "capture-task", sessionId: "capture-session", agent: "copilot", status: "running",
      startedAt: 1_791_038_000, finishedAt: null,
      events: [{ at: 1_791_038_000, kind: "started", data: { agent: "copilot" } }], result: null, error: null,
    });
    expect(request(fetch).init.method).toBe("GET");
  });

  it("keeps event gaps as running observations and does not schedule its own polling", async () => {
    const { client, fetch } = setup(fixtures["status_running"]);
    const first = await client.status("capture-task");
    const second = await client.status("capture-task");
    expect(second).toEqual(first);
    expect(second.status).toBe("running");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["status_completed", "status_cancelled"])("decodes the recorded %s result and timeline", async (fixture) => {
    const body = fixtures[fixture] as Record<string, unknown>;
    const { client } = setup(body);
    const result = await client.status("capture-task");
    expect(result.status).toBe(body["status"]);
    expect(result.result).toEqual(body["result"]);
    expect(result.events).toEqual(body["events"]);
    expect(result.finishedAt).toBe(body["finished_at"]);
  });

  it("preserves the locally recorded missing-invocation HTTP response", async () => {
    const record = recording.records["status_not_found"]!;
    const { client } = setup(record.body, record.status_code);
    await expect(client.status("missing")).rejects.toMatchObject({ kind: "http", statusCode: 404 });
  });

  it("supports Codex using the same contract and refuses a mismatched response agent", async () => {
    const body = { ...(fixtures["task_start"] as object), agent: "codex" };
    const { client, fetch } = setup(body);
    expect((await client.startTask({ ...workspace, agent: "codex", task: "Work" })).agent).toBe("codex");
    fetch.mockResolvedValue(new Response(JSON.stringify(fixtures["task_start"])));
    await expect(client.startTask({ ...workspace, agent: "codex", task: "Work" })).rejects.toMatchObject({ kind: "protocol" });
  });

  it.each(["completed", "failed", "paused", "interrupted", "cancelled", "needs_attention", "unknown"])("reports provider %s unchanged", async (status) => {
    const body = { ...(fixtures["status_running"] as object), status, finished_at: 1_759_440_002 };
    const { client } = setup(body);
    expect((await client.status("capture-task")).status).toBe(status);
  });

  it.each([204, 200])("explicitly deletes a session with HTTP %s and no extra invocation", async (status) => {
    const { client, fetch } = setup({ id: "capture-session" }, status);
    await expect(client.deleteSession("capture-session")).resolves.toBeUndefined();
    expect(request(fetch).init.method).toBe("DELETE");
    expect(request(fetch).url.pathname).toBe("/api/projects/jarvis/agents/jarvis-runner/endpoint/sessions/capture-session");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("routes administration to services.ai.azure.com and uses the versions route", async () => {
    const { client, fetch } = setup({ data: [] });
    await client.checkAdministration();
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).host)).toEqual(["example.services.ai.azure.com", "example.services.ai.azure.com"]);
    expect(request(fetch, 0).url.pathname).toBe("/api/projects/jarvis/connections");
    expect(request(fetch, 1).url.pathname).toBe("/api/projects/jarvis/agents/jarvis-runner/versions");
  });

  it("encodes identifiers and query values without letting them replace routes", async () => {
    const id = "session/with ?&";
    const { client, fetch } = setup({ session_id: id, status: "idle", paused_invocation: null }, 200, { agentName: "runner/variant", apiVersion: "v1&other=x" });
    await client.pause(id);
    expect(request(fetch).url.pathname).toContain("/agents/runner%2Fvariant/endpoint/");
    expect(request(fetch).url.searchParams.get("agent_session_id")).toBe(id);
    expect(request(fetch).url.searchParams.get("api-version")).toBe("v1&other=x");
    expect([...request(fetch).url.searchParams.keys()]).toEqual(["api-version", "agent_session_id"]);
  });
});

describe("bounded failures and validation", () => {
  it.each([404, 424, 500, 503, 401, 429])("preserves HTTP %s with no retry or fabricated status", async (statusCode) => {
    const { client, fetch } = setup({ error: `sensitive-provider-value-${token}` }, statusCode);
    await expect(client.status("capture-task")).rejects.toMatchObject({ kind: "http", operation: "status", statusCode });
    try { await client.status("capture-task") } catch (error) {
      expect(String(error)).not.toContain(token);
      expect(Object.keys(error as object)).not.toContain("body");
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry ambiguous failed creation", async () => {
    const { client, fetch } = setup();
    fetch.mockRejectedValue(new Error(`transport leaked ${token}`));
    await expect(client.startTask({ ...workspace, agent: "copilot", task: "Work" })).rejects.toMatchObject({ kind: "transport", message: "Foundry start: transport" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sanitizes auth errors and never fetches without a token", async () => {
    const { client, getToken, fetch } = setup();
    getToken.mockRejectedValue(new Error(`credential ${token}`));
    await expect(client.startTask({ ...workspace, agent: "copilot", task: "Work" })).rejects.toMatchObject({ kind: "auth", message: "Foundry start: auth" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["", "\r\ninvalid"])("rejects an invalid auth token before sending", async (value) => {
    const { client, getToken, fetch } = setup();
    getToken.mockResolvedValue(value);
    await expect(client.status("capture-task")).rejects.toMatchObject({ kind: "auth" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("honours cancellation before identity or HTTP work", async () => {
    const { client, fetch, getToken } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(client.status("capture-task", { signal: controller.signal })).rejects.toMatchObject({ kind: "aborted" });
    expect(fetch).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });

  it("bounds an auth provider that ignores cancellation", async () => {
    vi.useFakeTimers();
    const { client, fetch, getToken } = setup(undefined, 200, { requestTimeoutMs: 20 });
    getToken.mockImplementation(() => new Promise(() => {}));
    const pending = expect(client.status("capture-task")).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(20);
    await pending;
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a hung fetch and clears the deadline on caller cancellation", async () => {
    vi.useFakeTimers();
    const { client, fetch } = setup();
    fetch.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = expect(client.status("capture-task", { signal: controller.signal })).rejects.toMatchObject({ kind: "aborted" });
    await vi.advanceTimersByTimeAsync(0);
    const downstream = request(fetch).init.signal!;
    controller.abort();
    await pending;
    expect(downstream.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds and cancels a hung response stream", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const { client, fetch } = setup(undefined, 200, { requestTimeoutMs: 20 });
    fetch.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const pending = expect(client.status("capture-task")).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(20);
    await pending;
    expect(cancel).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["declared", "streamed"])("rejects %s oversized response and disposes the stream", async (mode) => {
    const cancel = vi.fn();
    const { client, fetch } = setup(undefined, 200, { maxResponseBytes: 8 });
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("too-much-data")) }, cancel });
    fetch.mockResolvedValue(new Response(stream, mode === "declared" ? { headers: { "content-length": "99" } } : {}));
    await expect(client.status("capture-task")).rejects.toMatchObject({ kind: "protocol" });
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects malformed JSON and unexpected response IDs", async () => {
    const { client, fetch } = setup({ ...(fixtures["status_running"] as object), invocation_id: "other" });
    await expect(client.status("capture-task")).rejects.toMatchObject({ kind: "protocol" });
    fetch.mockResolvedValue(new Response("not-json"));
    await expect(client.status("capture-task")).rejects.toMatchObject({ kind: "protocol" });
  });

  it.each([
    { status: "invented" }, { events: [{ at: 0, kind: "started", data: null }] },
    { started_at: "yesterday" }, { result: [] }, { error: {} },
  ])("rejects invalid status response fields %j", async (fields) => {
    const { client } = setup({ ...(fixtures["status_running"] as object), ...fields });
    await expect(client.status("capture-task")).rejects.toBeInstanceOf(FoundryClientError);
  });

  it("refuses a control response for a different session", async () => {
    const { client } = setup(fixtures["resume"]);
    await expect(client.resume("another", { ...workspace, agent: "copilot", task: "Continue" })).rejects.toMatchObject({ kind: "protocol" });
  });

  it("rejects blank identifiers, unsupported agents and oversized task input before auth", async () => {
    const { client, fetch, getToken } = setup();
    await expect(client.pause(" ")).rejects.toBeInstanceOf(TypeError);
    await expect(client.deleteSession("..")).rejects.toBeInstanceOf(TypeError);
    await expect(client.startTask({ ...workspace, agent: "other" as "copilot", task: "Work" })).rejects.toBeInstanceOf(TypeError);
    await expect(client.startTask({ ...workspace, agent: "copilot", task: "x".repeat(65_537) })).rejects.toBeInstanceOf(TypeError);
    await expect(client.startTask({ ...workspace, agent: "copilot", task: "Work", model: "x".repeat(101) })).rejects.toBeInstanceOf(TypeError);
    await expect(client.startTask({ ...workspace, agent: "codex", task: "Work", reasoning: "x".repeat(33) })).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });

  it("does not follow redirects carrying the identity token", async () => {
    const { client, fetch } = setup();
    const response = new Response("redirected");
    Object.defineProperty(response, "redirected", { value: true });
    fetch.mockResolvedValue(response);
    await expect(client.status("capture-task")).rejects.toMatchObject({ kind: "protocol" });
    expect(request(fetch).init.redirect).toBe("error");
  });

  it("retains HTTP failure diagnostics even if discarding its body fails", async () => {
    const { client, fetch } = setup();
    const body = new ReadableStream({ cancel() { throw new Error(token) } });
    fetch.mockResolvedValue(new Response(body, { status: 424 }));
    await expect(client.status("capture-task")).rejects.toMatchObject({ kind: "http", statusCode: 424 });
  });

  it.each([
    { runtimeEndpoint: adminEndpoint }, { adminEndpoint: runtimeEndpoint },
    { runtimeEndpoint: runtimeEndpoint.replace("https:", "http:") },
    { runtimeEndpoint: `${runtimeEndpoint}?secret=bad` },
    { adminEndpoint: adminEndpoint.replace("example.", "other.") },
    { requestTimeoutMs: 0 }, { maxResponseBytes: 0 },
  ])("validates endpoint routing and request bounds %j", (extra) => {
    expect(() => setup(undefined, 200, extra)).toThrow();
  });
});
