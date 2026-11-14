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

// The install id is this browser's identity and stays on this device. It is
// deliberately not put in synced storage: two computers signed in to the same
// Chrome profile would then share one identity and keep invalidating each
// other's token.
async function getInstallId() {
  const stored = (await local.get("installId")).installId;
  if (stored) return stored;
  const installId = randomId();
  await local.set({ installId });
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

// Looking at the account is read-only on the server. If the signed-in account
// has a license with a free seat that is not on this browser yet (for example
// one that was just issued to the user's email), ask for it.
async function refreshAccount() {
  const res = await request("/v1/me");
  if (res.account?.accountLicense?.reason === "available") {
    try {
      return (await request("/v1/license/attach", { method: "POST", body: {} })).account;
    } catch {
      /* keep the read-only view; the settings page offers the license explicitly */
    }
  }
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
  // The hash is remembered so requests from the popup, which has no X page
  // to read the handle from, carry the same identity.
  if (payload.handle) {
    body.xh = await sha256Hex(String(payload.handle).toLowerCase().replace(/^@/, ""));
    await local.set({ xh: body.xh });
  } else {
    const { xh } = await local.get("xh");
    if (xh) body.xh = xh;
  }

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

/* ----------------------------- Google sign-in ---------------------------- */

// Signing in happens in an ordinary tab: the server sends the browser to
// Google and back. When Google is done, the tab lands on the server's
// /auth/done page with a one-time completion code in the URL fragment. This
// worker sees that tab (it has host access to the server), presents the code
// together with this install's device token, and closes the tab. The server
// only signs in the install that started the attempt, so a completion code
// is useless to anyone else, and a sign-in link sent by someone else does
// nothing here.
const AUTH_DONE_URL = `${API_BASE}/auth/done`;
const SIGN_IN_WINDOW_MS = 15 * 60_000;
const finishing = new Set();

async function startSignIn() {
  const { url, done } = await request("/v1/auth/google/start", { method: "POST" });
  // The worker can only see the tab come back on the server it talks to. If
  // the server announces a different public address, say so now instead of
  // leaving the user on a page that never closes.
  if (done && !String(done).startsWith(AUTH_DONE_URL)) {
    throw new ApiError("server_misconfigured", `Sign-in is not set up correctly: the server's PUBLIC_URL (${new URL(done).origin}) is not the address this extension uses (${new URL(API_BASE).origin}).`);
  }
  const tab = await chrome.tabs.create({ url });
  await chrome.storage.session.set({ signIn: { tabId: tab.id, startedAt: Date.now() } });
  await local.set({ signInStatus: { state: "pending", at: Date.now() } });
  return {};
}

// Only the tab this worker opened for the sign-in counts. Any other page
// that shows up at the done address (a stray link, another site opening it)
// is ignored and cannot use up or cancel the real attempt.
async function finishSignIn(tabId, url) {
  const { signIn } = await chrome.storage.session.get("signIn");
  if (!signIn || signIn.tabId !== tabId || Date.now() - signIn.startedAt > SIGN_IN_WINDOW_MS) return;
  const code = new URLSearchParams(new URL(url).hash.slice(1)).get("code");
  if (!code || finishing.has(code)) return;
  finishing.add(code);
  try {
    await request("/v1/auth/google/complete", { method: "POST", body: { code } });
    await local.set({ signInStatus: { state: "done", at: Date.now() } });
    chrome.tabs.remove(tabId).catch(() => {});
  } catch (err) {
    await local.set({ signInStatus: { state: "error", message: err.message || "Sign-in did not finish.", at: Date.now() } });
  } finally {
    await chrome.storage.session.remove("signIn");
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && changeInfo.url.startsWith(AUTH_DONE_URL)) finishSignIn(tabId, changeInfo.url);
});

// If the user closes the sign-in tab, stop waiting for it.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { signIn } = await chrome.storage.session.get("signIn");
  if (signIn?.tabId !== tabId) return;
  await chrome.storage.session.remove("signIn");
  const { signInStatus } = await local.get("signInStatus");
  if (signInStatus?.state === "pending") await local.set({ signInStatus: { state: "cancelled", at: Date.now() } });
});

const handlers = {
  "xaigc:generate": (msg) => generate(msg.payload || {}),
  "xaigc:remember": async (msg) => {
    await remember(msg.text);
    return {};
  },
  "xaigc:account": async (msg) => ({ account: msg.refresh ? await refreshAccount() : await cachedAccount() }),
  "xaigc:activate": (msg) => request("/v1/license/activate", { method: "POST", body: { key: String(msg.key || ""), replaceOldest: msg.replaceOldest === true } }),
  "xaigc:deactivate": () => request("/v1/license/deactivate", { method: "POST" }),
  "xaigc:attach-license": (msg) => request("/v1/license/attach", { method: "POST", body: { replaceOldest: msg.replaceOldest === true } }),
  "xaigc:signin": () => startSignIn(),
  "xaigc:signout": () => request("/v1/auth/signout", { method: "POST" }),
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
