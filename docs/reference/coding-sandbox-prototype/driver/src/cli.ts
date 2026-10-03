import { exec } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { promisify } from "node:util";

type JsonObject = Record<string, unknown>;
type DriverConfig = {
  projectEndpoint: string;
  controlEndpoint: string;
  agentName: string;
  apiVersion: string;
  tenantId: string;
  subscriptionId: string;
};

const DEFAULT_TENANT_ID = "802efa29-17f2-4a79-8f5f-38f087aed96a";
const DEFAULT_SUBSCRIPTION_ID = "0ac7d719-89bc-4100-be87-a79d33e953a7";
const FOUNDRY_RESOURCE = "https://ai.azure.com/";
const FOUNDRY_SCOPE = `${FOUNDRY_RESOURCE}.default`;
const execAsync = promisify(exec);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted", "paused"]);

function config(): DriverConfig {
  const projectEndpoint = process.env["FOUNDRY_PROJECT_ENDPOINT"];
  if (!projectEndpoint) {
    throw new Error("FOUNDRY_PROJECT_ENDPOINT is required");
  }
  const tenantId = process.env["FOUNDRY_TENANT_ID"] ?? DEFAULT_TENANT_ID;
  const subscriptionId = process.env["FOUNDRY_SUBSCRIPTION_ID"] ?? DEFAULT_SUBSCRIPTION_ID;
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !/^[0-9a-f-]{36}$/i.test(subscriptionId)) {
    throw new Error("FOUNDRY_TENANT_ID and FOUNDRY_SUBSCRIPTION_ID must be UUIDs");
  }
  const runtimeEndpoint = projectEndpoint.replace(/\/$/, "");
  // Agent administration (connections, versions) lives on services.ai.azure.com;
  // sessions and Invocations use the account runtime host.
  const controlEndpoint = (
    process.env["FOUNDRY_CONTROL_ENDPOINT"] ??
    runtimeEndpoint.replace(".cognitiveservices.azure.com/", ".services.ai.azure.com/")
  ).replace(/\/$/, "");
  return {
    projectEndpoint: runtimeEndpoint,
    controlEndpoint,
    agentName: process.env["FOUNDRY_AGENT_NAME"] ?? "jarvis-runner",
    apiVersion: process.env["FOUNDRY_API_VERSION"] ?? "v1",
    tenantId,
    subscriptionId,
  };
}

async function verifyTargetSubscription(c: DriverConfig): Promise<void> {
  try {
    const result = await execAsync(
      `az account show --subscription ${c.subscriptionId} --query tenantId --output tsv --only-show-errors`,
      { windowsHide: true },
    );
    if (result.stdout.trim() !== c.tenantId) {
      throw new Error("Azure CLI target subscription is not in FOUNDRY_TENANT_ID");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("FOUNDRY_TENANT_ID")) {
      throw error;
    }
    throw new Error("Unable to verify the target Azure subscription and tenant");
  }
}

type AccessToken = {
  token: string;
  expiresOnTimestamp: number;
};

class TargetTenantAzureCliCredential {
  public constructor(
    private readonly tenantId: string,
    private readonly subscriptionId: string,
  ) {}

  public async getToken(): Promise<AccessToken> {
    const result = await execAsync(
      `az account get-access-token --resource ${FOUNDRY_RESOURCE} --subscription ${this.subscriptionId} --query accessToken --output tsv --only-show-errors`,
      { windowsHide: true, maxBuffer: 128 * 1024 },
    );
    const tokenValue = result.stdout.trim();
    const claims = decodeJwtPayload(tokenValue);
    if (claims["tid"] !== this.tenantId) {
      throw new Error("Foundry token tenant does not match FOUNDRY_TENANT_ID");
    }
    const expires = claims["exp"];
    if (typeof expires !== "number") {
      throw new Error("Foundry token has no expiry claim");
    }
    return { token: tokenValue, expiresOnTimestamp: expires * 1000 };
  }
}

function decodeJwtPayload(tokenValue: string): JsonObject {
  const parts = tokenValue.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new Error("Foundry token is not a JWT");
  }
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JWT payload is not an object");
    }
    return parsed as JsonObject;
  } catch {
    throw new Error("Foundry token payload could not be decoded");
  }
}

async function token(c: DriverConfig): Promise<string> {
  await verifyTargetSubscription(c);
  const accessToken = await new TargetTenantAzureCliCredential(c.tenantId, c.subscriptionId).getToken();
  if (!accessToken?.token) {
    throw new Error("Unable to acquire a Foundry Entra token");
  }
  const claims = decodeJwtPayload(accessToken.token);
  if (claims["tid"] !== c.tenantId) {
    throw new Error("Foundry token tenant does not match FOUNDRY_TENANT_ID");
  }
  const audience = claims["aud"];
  if (audience !== "https://ai.azure.com" && audience !== "https://ai.azure.com/") {
    throw new Error("Foundry token audience is not https://ai.azure.com");
  }
  return accessToken.token;
}

function endpoint(c: DriverConfig, suffix: string, query: Record<string, string> = {}): string {
  const params = new URLSearchParams({ "api-version": c.apiVersion, ...query });
  return `${c.projectEndpoint}/agents/${encodeURIComponent(c.agentName)}/endpoint/${suffix}?${params.toString()}`;
}

function projectEndpoint(c: DriverConfig, suffix: string, query: Record<string, string> = {}): string {
  const params = new URLSearchParams({ "api-version": c.apiVersion, ...query });
  return `${c.controlEndpoint}/${suffix}?${params.toString()}`;
}

async function requestJson(
  c: DriverConfig,
  url: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: JsonObject | string }> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await token(c)}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let body: JsonObject | string;
  try {
    body = JSON.parse(text) as JsonObject;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`Foundry ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return { response, body };
}

async function foundry(
  c: DriverConfig,
  suffix: string,
  init: RequestInit = {},
  query: Record<string, string> = {},
): Promise<{ response: Response; body: JsonObject | string }> {
  return requestJson(c, endpoint(c, suffix, query), init);
}

async function foundryProject(
  c: DriverConfig,
  suffix: string,
): Promise<{ response: Response; body: JsonObject | string }> {
  return requestJson(c, projectEndpoint(c, suffix));
}

async function projectStatus(c: DriverConfig, suffix: string): Promise<{ status: number; error?: string }> {
  try {
    const result = await foundryProject(c, suffix);
    return { status: result.response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Foundry error";
    const match = /^Foundry (\d+):/.exec(message);
    return { status: match ? Number(match[1]) : 0, error: message };
  }
}

function usage(): never {
  console.error(`Usage:
  npm start -- preflight
  npm start -- start --agent copilot|codex --task "..."
  npm start -- steer --session ID --agent copilot|codex --message "..."
  npm start -- pause --session ID
  npm start -- resume --session ID --agent copilot|codex --task "..."
  npm start -- cancel --invocation ID
  npm start -- events --invocation ID [--follow]
  npm start -- sessions
  npm start -- delete-session --session ID
  npm start -- test-steering --agent copilot|codex
  npm start -- test-pause-resume --agent copilot|codex
  npm start -- renew-codex [--force]`);
  process.exit(2);
}

async function preflight(): Promise<void> {
  const c = config();
  const accessToken = await token(c);
  const claims = decodeJwtPayload(accessToken);
  const [connections, versions] = await Promise.all([
    projectStatus(c, "connections"),
    projectStatus(c, `agents/${encodeURIComponent(c.agentName)}/versions`),
  ]);
  console.log(
    JSON.stringify(
      {
        tenantId: claims["tid"],
        audience: claims["aud"],
        subscriptionId: c.subscriptionId,
        projectEndpoint: c.projectEndpoint,
        controlEndpoint: c.controlEndpoint,
        connectionsStatus: connections.status,
        agentVersionsStatus: versions.status,
        connectionsError: connections.error,
        agentVersionsError: versions.error,
      },
      null,
      2,
    ),
  );
  if (connections.status !== 200 || versions.status !== 200) {
    throw new Error("Foundry project preflight failed; do not start a coding task");
  }
}

function value(args: string[], name: string): string {
  const index = args.indexOf(name);
  const result = args[index + 1];
  if (index < 0 || !result) usage();
  return result;
}

async function start(args: string[]): Promise<void> {
  const c = config();
  const agent = value(args, "--agent").toLowerCase();
  const task = value(args, "--task");
  if (agent !== "copilot" && agent !== "codex") throw new Error("agent must be copilot or codex");
  const { body } = await foundry(c, "protocols/invocations", {
    method: "POST",
    body: JSON.stringify({ agent, task }),
  });
  console.log(JSON.stringify(body, null, 2));
}

async function getInvocation(c: DriverConfig, invocationId: string): Promise<JsonObject> {
  const { body } = await foundry(c, `protocols/invocations/${encodeURIComponent(invocationId)}`);
  if (typeof body === "string") throw new Error("Invocation response was not JSON");
  return body;
}

async function events(args: string[]): Promise<void> {
  const c = config();
  const invocationId = value(args, "--invocation");
  const follow = args.includes("--follow");
  let seen = 0;
  do {
    const body = await getInvocation(c, invocationId);
    const events = Array.isArray(body["events"]) ? body["events"] : [];
    for (const event of events.slice(seen)) console.log(JSON.stringify(event));
    seen = events.length;
    const status = body["status"];
    if (!follow || TERMINAL_STATUSES.has(String(status))) {
      console.log(JSON.stringify(body, null, 2));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  } while (true);
}

async function steer(args: string[]): Promise<void> {
  const c = config();
  const sessionId = value(args, "--session");
  const agent = value(args, "--agent").toLowerCase();
  const message = value(args, "--message");
  if (agent !== "copilot" && agent !== "codex") throw new Error("agent must be copilot or codex");
  console.log(JSON.stringify(await sendSteer(c, sessionId, agent, message), null, 2));
}

async function pause(args: string[]): Promise<void> {
  const c = config();
  const sessionId = value(args, "--session");
  console.log(JSON.stringify(await sendPause(c, sessionId), null, 2));
}

async function sendTask(c: DriverConfig, agent: string, task: string, sessionId?: string): Promise<JsonObject> {
  const { body } = await foundry(
    c,
    "protocols/invocations",
    { method: "POST", body: JSON.stringify({ agent, task }) },
    sessionId ? { agent_session_id: sessionId } : {},
  );
  if (typeof body === "string") throw new Error("Invocation response was not JSON");
  return body;
}

async function sendSteer(c: DriverConfig, sessionId: string, agent: string, message: string): Promise<JsonObject> {
  const { body } = await foundry(
    c,
    "protocols/invocations",
    { method: "POST", body: JSON.stringify({ agent, mode: "steer", message }) },
    { agent_session_id: sessionId },
  );
  if (typeof body === "string") throw new Error("Steer response was not JSON");
  return body;
}

async function sendPause(c: DriverConfig, sessionId: string): Promise<JsonObject> {
  const { body } = await foundry(
    c,
    "protocols/invocations",
    { method: "POST", body: JSON.stringify({ mode: "pause" }) },
    { agent_session_id: sessionId },
  );
  if (typeof body === "string") throw new Error("Pause response was not JSON");
  return body;
}

async function resume(args: string[]): Promise<void> {
  const c = config();
  const sessionId = value(args, "--session");
  const agent = value(args, "--agent").toLowerCase();
  const task = value(args, "--task");
  if (agent !== "copilot" && agent !== "codex") throw new Error("agent must be copilot or codex");
  const { body } = await foundry(
    c,
    "protocols/invocations",
    {
      method: "POST",
      body: JSON.stringify({ agent, task }),
    },
    { agent_session_id: sessionId },
  );
  console.log(JSON.stringify({ resumed_session: sessionId, response: body }, null, 2));
}

async function cancel(args: string[]): Promise<void> {
  const c = config();
  const invocationId = value(args, "--invocation");
  const { body } = await foundry(
    c,
    `protocols/invocations/${encodeURIComponent(invocationId)}/cancel`,
    { method: "POST" },
  );
  console.log(JSON.stringify(body, null, 2));
}

async function sessions(): Promise<void> {
  const c = config();
  const { body } = await foundry(c, "sessions");
  console.log(JSON.stringify(body, null, 2));
}

async function deleteSession(args: string[]): Promise<void> {
  const c = config();
  const sessionId = value(args, "--session");
  const { body } = await foundry(c, `sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  console.log(JSON.stringify(body, null, 2));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function agentArg(args: string[]): string {
  const agent = value(args, "--agent").toLowerCase();
  if (agent !== "copilot" && agent !== "codex") throw new Error("agent must be copilot or codex");
  return agent;
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
}

async function waitForStatus(c: DriverConfig, invocationId: string, timeoutMs: number): Promise<JsonObject> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = await getInvocation(c, invocationId);
    if (TERMINAL_STATUSES.has(String(body["status"])) || Date.now() > deadline) return body;
    await sleep(5_000);
  }
}

async function waitForEvents(
  c: DriverConfig,
  invocationId: string,
  match: (eventsJson: string) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await getInvocation(c, invocationId);
    if (match(JSON.stringify(body["events"] ?? []))) return true;
    if (TERMINAL_STATUSES.has(String(body["status"]))) return false;
    await sleep(3_000);
  }
  return false;
}

const KEY_EVENTS = new Set([
  "started", "runner_instance", "acp_initialized", "acp_session", "acp_session_loaded",
  "steer_requested", "pause_requested", "acp_cancel_sent", "stop_timeout_forced", "steer_after",
  "interrupted", "paused", "completed", "failed",
]);

function summary(body: JsonObject): JsonObject {
  const events = Array.isArray(body["events"]) ? (body["events"] as JsonObject[]) : [];
  return {
    invocation_id: body["invocation_id"],
    status: body["status"],
    started_at: body["started_at"],
    finished_at: body["finished_at"],
    error: body["error"],
    events: events
      .filter((e) => KEY_EVENTS.has(String(e["kind"])))
      .map((e) => {
        const data = (e["data"] ?? {}) as JsonObject;
        const result = data["result"] as JsonObject | undefined;
        const response = result?.["response"] as JsonObject | undefined;
        return {
          at: new Date(Number(e["at"]) * 1000).toISOString(),
          kind: e["kind"],
          data: result ? { stopReason: response?.["stopReason"] } : data,
        };
      }),
  };
}

function instanceOf(body: JsonObject): JsonObject | undefined {
  const events = Array.isArray(body["events"]) ? (body["events"] as JsonObject[]) : [];
  return events.find((e) => e["kind"] === "runner_instance")?.["data"] as JsonObject | undefined;
}

async function testSteering(args: string[]): Promise<void> {
  const c = config();
  const agent = agentArg(args);
  const id = stamp();
  const branch = `steer-${agent}-${id}`;
  const file = `steering/${agent}-${id}.md`;
  const task =
    `Clone DanAakesen/jarvis-poc-target into a new directory and create the branch ${branch}. ` +
    `Create the file ${file} with the heading "# Numbers", then append the numbers 1 to 300, one per line. ` +
    `Append them in batches of 25 lines; after each batch run git add and git commit, then run \`sleep 10\` before the next batch. ` +
    `When all numbers are written, push the branch and open a pull request titled "Steering test (${agent})". Do not merge it.`;
  const first = await sendTask(c, agent, task);
  const sessionId = String(first["session_id"]);
  const firstId = String(first["invocation_id"]);
  console.error(`started ${firstId} in session ${sessionId}`);
  const working = await waitForEvents(c, firstId, (text) => text.includes('"tool_call"'), 10 * 60_000);
  await sleep(20_000);
  const correction =
    `Change of plan: ${file} must contain only the EVEN numbers from 2 to 300, and its heading must be "# Even numbers". ` +
    `Rewrite anything already written so it matches, then commit, push the branch ${branch}, ` +
    `and open the pull request titled "Steering test (${agent}) - even numbers". Do not merge it.`;
  const steered = await sendSteer(c, sessionId, agent, correction);
  const steerId = String(steered["invocation_id"]);
  console.error(`steered with ${steerId}`);
  const firstFinal = await waitForStatus(c, firstId, 5 * 60_000);
  const steerFinal = await waitForStatus(c, steerId, 40 * 60_000);
  console.log(JSON.stringify(
    { test: "steering", agent, sessionId, branch, file, agentWasWorking: working, first: summary(firstFinal), steer: summary(steerFinal) },
    null,
    2,
  ));
}

async function testPauseResume(args: string[]): Promise<void> {
  const c = config();
  const agent = agentArg(args);
  const id = stamp();
  const branch = `pause-${agent}-${id}`;
  const marker = `MARKER-${randomBytes(4).toString("hex")}`;
  const codeWord = `${["heron", "maple", "cobalt", "juniper", "falcon"][randomInt(5)]}-${randomInt(100, 1000)}`;
  const markerFile = `pause/${agent}-${id}-marker.txt`;
  const numbersFile = `pause/${agent}-${id}-numbers.txt`;
  const codeWordFile = `pause/${agent}-${id}-codeword.txt`;
  const idleSeconds = Number(process.env["JARVIS_IDLE_WAIT_SECONDS"] ?? "180");
  const task =
    `Clone DanAakesen/jarvis-poc-target into a new directory and create the branch ${branch}. ` +
    `First create ${markerFile} containing exactly "${marker}" and commit it, but do not push yet. ` +
    `Remember this code word for later and do not write it to any file yet: ${codeWord}. ` +
    `Then append the numbers 1 to 200 to ${numbersFile}, one per line, in batches of 20 lines; after each batch commit, then run \`sleep 15\` before the next batch. ` +
    `Do not push until all numbers are written.`;
  const first = await sendTask(c, agent, task);
  const sessionId = String(first["session_id"]);
  const firstId = String(first["invocation_id"]);
  console.error(`started ${firstId} in session ${sessionId}`);
  // Pause once the marker shows up in the event stream, or after 100 s of work at the latest:
  // some agents only echo file contents in their final message.
  const markerSeen = await waitForEvents(c, firstId, (text) => text.includes(marker), 100_000);
  if (markerSeen) await sleep(10_000);
  const pausedAtIso = new Date().toISOString();
  const paused = await sendPause(c, sessionId);
  console.error(`pause requested: ${JSON.stringify(paused)}`);
  const firstFinal = await waitForStatus(c, firstId, 4 * 60_000);
  // No requests reach the session during this wait, so Foundry deprovisions it after the idle timeout.
  console.error(`waiting ${idleSeconds}s with no requests`);
  await sleep(idleSeconds * 1000);
  const resumeTask =
    `You were paused and have now been resumed. First write the code word I gave you earlier into ${codeWordFile} ` +
    `(only the code word) and commit it. Then check that ${markerFile} still exists, finish appending the numbers 1 to 200 ` +
    `to ${numbersFile}, push the branch ${branch}, and open a pull request titled "Pause/resume test (${agent})". Do not merge it.`;
  const resumed = await sendTask(c, agent, resumeTask, sessionId);
  const resumedId = String(resumed["invocation_id"]);
  console.error(`resumed with ${resumedId}`);
  const resumeFinal = await waitForStatus(c, resumedId, 40 * 60_000);
  console.log(JSON.stringify(
    {
      test: "pause-resume", agent, sessionId, branch, marker, codeWord, markerFile, numbersFile, codeWordFile,
      markerSeenBeforePause: markerSeen, pausedAt: pausedAtIso, pauseResponse: paused, idleSeconds,
      instanceBefore: instanceOf(firstFinal), instanceAfter: instanceOf(resumeFinal),
      first: summary(firstFinal), resume: summary(resumeFinal),
    },
    null,
    2,
  ));
}

async function renewCodex(args: string[]): Promise<void> {
  const c = config();
  const force = args.includes("--force");
  const listed = await foundry(c, "sessions");
  const sessionsBody = typeof listed.body === "string" ? {} : listed.body;
  const active = (Array.isArray(sessionsBody["data"]) ? (sessionsBody["data"] as JsonObject[]) : []).filter(
    (s) => s["status"] === "active",
  );
  // Renewal invalidates the previous login, so no Codex turn may be running.
  if (active.length > 0) throw new Error(`Refusing to renew while ${active.length} session(s) are active`);
  const { body } = await foundry(c, "protocols/invocations", {
    method: "POST",
    body: JSON.stringify({ agent: "codex", mode: "renew-codex", force }),
  });
  if (typeof body === "string") throw new Error("Renewal response was not JSON");
  console.log(JSON.stringify(body, null, 2));
  const sessionId = body["session_id"];
  if (typeof sessionId === "string") {
    await foundry(c, `sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  }
  if (body["error"] || (force && body["stored"] !== true)) process.exitCode = 1;
}

const [command, ...args] = process.argv.slice(2);
if (!command) usage();
const commands: Record<string, (args: string[]) => Promise<void>> = {
  preflight: async () => preflight(),
  start,
  steer,
  pause,
  resume,
  cancel,
  events,
  sessions: async () => sessions(),
  "delete-session": deleteSession,
  "test-steering": testSteering,
  "test-pause-resume": testPauseResume,
  "renew-codex": renewCodex,
};
const handler = commands[command];
if (!handler) usage();
handler(args).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown driver error");
  process.exitCode = 1;
});
