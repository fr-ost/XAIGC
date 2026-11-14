// XAIGC service worker.
//
// The only part of the extension that talks to the XAIGC server. Content
// scripts, the popup and the options page send it messages; it attaches the
// device token, the user's voice settings and recent-reply memory, and keeps
// a cached copy of the account (plan, remaining quota) in storage so every
// surface can render without a network round trip.
//
// No OpenAI key lives in the extension. Generation happens on the server.

import { API_BASE, CLIENT_VERSION, DEFAULT_SETTINGS } from "./config.js";

const RECENT_MAX = 30;
const RECENT_SENT = 8;
const REQUEST_TIMEOUT_MS = 45_000;

class ApiError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

/* ------------------------------- storage --------------------------------- */

const local = chrome.storage.local;

async function getSettings() {
  const { settings } = await local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function saveAccount(account) {
  if (!account) return;
  await local.set({ account, accountAt: Date.now() });
  updateBadge(account);
}

function updateBadge(account) {
  try {
    const trial = account && !account.licensed;
    const left = account?.quota?.remaining ?? 0;
    chrome.action.setBadgeText({ text: trial && left <= 5 ? String(left) : "" });
    chrome.action.setBadgeBackgroundColor({ color: left === 0 ? "#c0362c" : "#4b5563" });
  } catch {
    /* badge is cosmetic */
  }
}

function randomId(bytes = 24) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The install id is kept in sync storage as well, so reinstalling on the
// same Chrome profile restores the same device (and its license) instead of
// starting over.
async function getInstallId() {
  let synced = null;
  try {
    synced = (await chrome.storage.sync.get("installId")).installId || null;
  } catch {
    /* sync storage unavailable */
  }
  const stored = (await local.get("installId")).installId || null;
  const installId = synced || stored || randomId();
  if (installId !== stored) await local.set({ installId });
  if (installId !== synced) {
    try {
      await chrome.storage.sync.set({ installId });
    } catch {
      /* best effort */
    }
  }
  return installId;
}

/* --------------------------------- API ----------------------------------- */

let registering = null;

async function register() {
  if (!registering) {
    registering = (async () => {
      const installId = await getInstallId();
      const res = await request("/v1/devices", { method: "POST", body: { installId }, auth: false });
      await local.set({ deviceToken: res.token, deviceId: res.deviceId });
      return res.token;
    })().finally(() => {
      registering = null;
    });
  }
  return registering;
}

async function getToken() {
  const { deviceToken } = await local.get("deviceToken");
  return deviceToken || register();
}

async function request(path, { method = "GET", body, auth = true, retried = false } = {}) {
  const headers = { "X-XAIGC-Client": CLIENT_VERSION };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) headers.Authorization = `Bearer ${await getToken()}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new ApiError("network", timedOut ? "The XAIGC server took too long to answer. Try again." : "Can't reach the XAIGC server. Check your connection and try again.");
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  // The server no longer knows this token (for example after a reinstall on
  // another profile rotated it): register again once and retry.
  if (res.status === 401 && auth && !retried) {
    await local.remove("deviceToken");
    return request(path, { method, body, auth, retried: true });
  }

  if (!res.ok) {
    const error = json?.error || {};
    if (error.account) await saveAccount(error.account);
    const { code, message, account, ...extra } = error;
    throw new ApiError(code || `http_${res.status}`, message || `The XAIGC server returned an error (${res.status}).`, extra);
  }
  if (json?.account) await saveAccount(json.account);
  return json;
}

/* -------------------------------- actions -------------------------------- */

async function refreshAccount() {
  const res = await request("/v1/me");
  return res.account;
}

async function cachedAccount({ maxAgeMs = 5 * 60_000 } = {}) {
  const { account, accountAt } = await local.get(["account", "accountAt"]);
  if (account && Date.now() - (accountAt || 0) < maxAgeMs) return account;
  return refreshAccount();
}

async function generate(payload) {
  const settings = await getSettings();
  const kind = payload.kind;
  const body = {
    kind,
    options: {
      tone: payload.tone || settings.tone,
      persona: settings.persona,
      length: payload.length || settings.length,
      language: settings.language,
      emoji: settings.emoji,
    },
  };
  if (payload.post) body.post = payload.post;
  if (payload.idea) body.idea = payload.idea;
  if (payload.draft) body.draft = payload.draft;
  if (payload.tweets) body.options.tweets = payload.tweets;
  if (payload.rejected?.length) body.rejected = payload.rejected.slice(0, 4).map((s) => String(s).slice(0, 400));

  // Recent replies let the server steer away from repeating itself. They
  // stay on this device; only the latest few are sent with a request.
  if (kind === "reply" || kind === "question" || kind === "quote") {
    const { recentReplies = [] } = await local.get("recentReplies");
    if (recentReplies.length) body.recent = recentReplies.slice(0, RECENT_SENT).map((s) => String(s).slice(0, 400));
  }

  // The signed-in X handle is hashed here and never sent in the clear. The
  // server uses it only to stop the free trial being reset by reinstalling.
  if (payload.handle) body.xh = await sha256Hex(String(payload.handle).toLowerCase().replace(/^@/, ""));

  try {
    return await request("/v1/generate", { method: "POST", body });
  } catch (err) {
    // The server asks for a short pause between generations. Rather than
    // show an error for a quick second click, wait it out once.
    const pause = Number(err?.extra?.retryAfter) || 0;
    if (err?.code === "cooldown" && pause > 0 && pause <= 3) {
      await new Promise((resolve) => setTimeout(resolve, pause * 1000));
      return request("/v1/generate", { method: "POST", body });
    }
    throw err;
  }
}

async function remember(text) {
  const clean = String(text || "").trim();
  if (!clean) return;
  const { recentReplies = [] } = await local.get("recentReplies");
  await local.set({ recentReplies: [clean, ...recentReplies.filter((r) => r !== clean)].slice(0, RECENT_MAX) });
}

const handlers = {
  "xaigc:generate": (msg) => generate(msg.payload || {}),
  "xaigc:remember": async (msg) => {
    await remember(msg.text);
    return {};
  },
  "xaigc:account": async (msg) => ({ account: msg.refresh ? await refreshAccount() : await cachedAccount() }),
  "xaigc:activate": (msg) => request("/v1/license/activate", { method: "POST", body: { key: String(msg.key || ""), replaceOldest: msg.replaceOldest === true } }),
  "xaigc:deactivate": () => request("/v1/license/deactivate", { method: "POST" }),
  "xaigc:clear-memory": async () => {
    await local.remove("recentReplies");
    return {};
  },
  "xaigc:info": async () => {
    const { deviceId } = await local.get("deviceId");
    return { deviceId: deviceId || null, apiBase: API_BASE, version: CLIENT_VERSION };
  },
  "xaigc:open-options": async (msg) => {
    const url = chrome.runtime.getURL(`options.html${msg.section ? `#${msg.section}` : ""}`);
    await chrome.tabs.create({ url });
    return {};
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  // Only this extension's own pages and content scripts may drive the worker.
  if (sender.id !== chrome.runtime.id) return false;
  handler(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => {
      if (!(err instanceof ApiError)) console.error("[XAIGC]", err);
      sendResponse({
        ok: false,
        error: { code: err.code || "unexpected", message: err.message || "Something went wrong.", ...(err.extra || {}) },
      });
    });
  return true; // respond asynchronously
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html#welcome") });
  }
  try {
    await refreshAccount();
  } catch {
    /* the server may be unreachable right now; the first real action retries */
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const { account } = await local.get("account");
  updateBadge(account);
});
