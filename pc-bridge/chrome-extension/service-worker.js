const HOST_NAME = "com.jarvis.pcbridge";
const MAX_TABS = 5000;
const MAX_MESSAGE_BYTES = 64 * 1024;
const ATTACHMENT_IDLE_MS = 30_000;
const CDP_METHODS = new Set([
  "Runtime.evaluate",
  "Runtime.getProperties",
  "Runtime.callFunctionOn",
  "Runtime.releaseObjectGroup",
]);
const attachedTabs = new Set();
const detachTimers = new Map();
let nativePort;
let reconnectTimer;
let reconnectDelay = 1_000;

function isRequest(value) {
  return value !== null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id);
}

function hasOnlyKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function extensionTabId(value) {
  return typeof value === "string" && /^tab_[0-9]{1,10}$/.test(value)
    ? Number(value.slice(4))
    : null;
}

async function detach(tabId) {
  const timer = detachTimers.get(tabId);
  if (timer) clearTimeout(timer);
  detachTimers.delete(tabId);
  if (!attachedTabs.delete(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
  }
}

function scheduleDetach(tabId) {
  const timer = detachTimers.get(tabId);
  if (timer) clearTimeout(timer);
  detachTimers.set(tabId, setTimeout(() => { void detach(tabId); }, ATTACHMENT_IDLE_MS));
}

async function attach(tabId) {
  if (!attachedTabs.has(tabId)) {
    await chrome.debugger.attach({ tabId }, "1.3");
    attachedTabs.add(tabId);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => Boolean(document.documentElement && document.readyState),
      });
    } catch (error) {
      await detach(tabId);
      throw error;
    }
  }
  scheduleDetach(tabId);
}

function post(message) {
  if (!nativePort) return;
  const encoded = JSON.stringify(message);
  if (new TextEncoder().encode(encoded).byteLength > MAX_MESSAGE_BYTES) return;
  try {
    nativePort.postMessage(message);
  } catch {
  }
}

async function handleRequest(request) {
  if (!isRequest(request)) return;
  try {
    if (request.type === "list_tabs") {
      if (!hasOnlyKeys(request, ["id", "type", "offset", "limit"])) throw new Error("not_allowed");
      if (!Number.isInteger(request.offset) || request.offset < 0 || request.offset > MAX_TABS ||
          !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 20) {
        throw new Error("not_allowed");
      }
      const tabs = await chrome.tabs.query({});
      const allTabs = tabs.slice(0, MAX_TABS).flatMap((tab) =>
        Number.isSafeInteger(tab.id)
          ? [{
              id: `tab_${tab.id}`,
              title: (tab.title || "").slice(0, 300),
              url: (tab.url || "").slice(0, 2048),
              focused: Boolean(tab.active),
            }]
          : []);
      const result = allTabs.slice(request.offset, request.offset + request.limit);
      const nextOffset = request.offset + result.length < allTabs.length
        ? request.offset + result.length
        : null;
      post({ id: request.id, type: "result", result: { tabs: result, nextOffset } });
      return;
    }

    if (request.type === "open_url") {
      if (!hasOnlyKeys(request, ["id", "type", "url"]) ||
          typeof request.url !== "string" || request.url.length > 2048 ||
          /[\u0000-\u001f\u007f]/.test(request.url)) {
        throw new Error("not_allowed");
      }
      let url;
      try {
        url = new URL(request.url);
      } catch {
        throw new Error("not_allowed");
      }
      if ((url.protocol !== "http:" && url.protocol !== "https:") ||
          !url.hostname || url.username || url.password) {
        throw new Error("not_allowed");
      }
      const tab = await chrome.tabs.create({ url: url.href, active: true });
      if (!Number.isSafeInteger(tab.windowId)) throw new Error("failed");
      await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
      post({ id: request.id, type: "result", result: { opened: true, focused: true } });
      return;
    }

    const tabId = extensionTabId(request.tabId);
    if (tabId === null) throw new Error("not_found");

    if (request.type === "detach") {
      if (!hasOnlyKeys(request, ["id", "type", "tabId"])) throw new Error("not_allowed");
      await detach(tabId);
      post({ id: request.id, type: "result", result: {} });
      return;
    }

    if (request.type !== "cdp" || !CDP_METHODS.has(request.method) ||
        !hasOnlyKeys(request, ["id", "type", "tabId", "method", "parameters"]) ||
        request.parameters === null || typeof request.parameters !== "object" ||
        Array.isArray(request.parameters)) {
      throw new Error("not_allowed");
    }

    if (!validParameters(request.method, request.parameters)) throw new Error("not_allowed");
    await attach(tabId);
    const result = await chrome.debugger.sendCommand(
      { tabId },
      request.method,
      request.parameters,
    );
    post({ id: request.id, type: "result", result });
  } catch (error) {
    const code = error instanceof Error && [
      "not_found", "failed", "not_allowed", "browser_off", "blocked", "stale", "covered",
    ].includes(error.message) ? error.message : "failed";
    post({ id: request.id, type: "error", error: code });
  }
}

function validParameters(method, parameters) {
  if (method === "Runtime.evaluate") {
    return hasOnlyKeys(parameters, ["expression", "objectGroup", "returnByValue", "awaitPromise"]) &&
      typeof parameters.expression === "string" && parameters.expression.length <= 16_384 &&
      parameters.expression.startsWith("(() => {") && parameters.expression.includes("document.querySelectorAll") &&
      typeof parameters.objectGroup === "string" &&
      /^jarvis-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parameters.objectGroup) &&
      parameters.returnByValue === false && parameters.awaitPromise === false;
  }
  if (method === "Runtime.getProperties") {
    return hasOnlyKeys(parameters, ["objectId", "ownProperties", "accessorPropertiesOnly", "generatePreview"]) &&
      typeof parameters.objectId === "string" && parameters.objectId.length <= 512 &&
      parameters.ownProperties === true && parameters.accessorPropertiesOnly === false &&
      parameters.generatePreview === false;
  }
  if (method === "Runtime.callFunctionOn") {
    return hasOnlyKeys(parameters, [
      "objectId", "functionDeclaration", "arguments", "returnByValue", "awaitPromise", "userGesture",
    ]) &&
      typeof parameters.objectId === "string" && parameters.objectId.length <= 512 &&
      typeof parameters.functionDeclaration === "string" && parameters.functionDeclaration.length <= 12_000 &&
      parameters.functionDeclaration.startsWith("function(expected, role, name, action, value, confirmed)") &&
      Array.isArray(parameters.arguments) && parameters.arguments.length === 6 &&
      parameters.arguments.every((argument) =>
        argument !== null && typeof argument === "object" &&
        hasOnlyKeys(argument, ["value"])) &&
      parameters.arguments.slice(0, 5).every((argument) =>
        argument.value === null || typeof argument.value === "string") &&
      ["click", "type", "select", "scroll", "wait"].includes(parameters.arguments[3].value) &&
      typeof parameters.arguments[5].value === "boolean" &&
      parameters.returnByValue === true && parameters.awaitPromise === false && parameters.userGesture === true;
  }
  return method === "Runtime.releaseObjectGroup" &&
    hasOnlyKeys(parameters, ["objectGroup"]) &&
    typeof parameters.objectGroup === "string" &&
    /^jarvis-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parameters.objectGroup);
}

function connectNativeHost() {
  let port;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch {
    scheduleReconnect();
    return;
  }
  nativePort = port;
  port.onMessage.addListener((request) => {
    reconnectDelay = 1_000;
    void handleRequest(request);
  });
  port.onDisconnect.addListener(() => {
    if (nativePort === port) nativePort = undefined;
    for (const tabId of [...attachedTabs]) void detach(tabId);
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connectNativeHost();
  }, delay);
}

chrome.debugger.onDetach.addListener((source) => {
  if (Number.isSafeInteger(source.tabId)) {
    attachedTabs.delete(source.tabId);
    const timer = detachTimers.get(source.tabId);
    if (timer) clearTimeout(timer);
    detachTimers.delete(source.tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void detach(tabId);
  post({
    id: crypto.randomUUID(),
    type: "event",
    event: "tab_removed",
    tabId: `tab_${tabId}`,
  });
});

connectNativeHost();
