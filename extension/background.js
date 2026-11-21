// XAICG service worker.
//
// The only part of the extension that talks to the XAICG server. Content
// scripts, the popup and the options page send it messages; it attaches the
// device token, the user's voice settings and recent-reply memory, and keeps
// a cached copy of the account (plan, remaining quota) in storage so every
// surface can render without a network round trip.
//
// No OpenAI key lives in the extension. Generation happens on the server,
// except in the Unlimited edition, where free users' drafts are written on
// their own computer by Chrome's built-in AI (lib/ondevice.js). In the
// standard edition that module is empty and nothing below changes.

import { API_BASE, CLIENT_VERSION, DEFAULT_SETTINGS, EDITION } from "./config.js";
import { onDevice } from "./lib/ondevice.js";

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
    // On the free plan, the icon counts down the last of the day's comments.
    // Drafts written on this computer are not counted, so there is nothing to show.
    const free = account && !account.licensed && !account.auth?.signInRequired && lastRoute?.engine !== "device";
    const left = account?.quota?.remaining ?? 0;
    chrome.action.setBadgeText({ text: free && left <= 2 ? String(left) : "" });
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
    throw new ApiError("network", timedOut ? "The XAICG server took too long to answer. Try again." : "Can't reach the XAICG server. Check your connection and try again.");
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
    throw new ApiError(code || `http_${res.status}`, message || `The XAICG server returned an error (${res.status}).`, extra);
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

/* ------------------------- on this computer (Unlimited) ------------------------- */

// Where the next draft is written, and why. The answer is kept in storage
// (deviceRoute) so the buttons on x.com can say "unlimited" without asking.
let lastRoute = null;
const ROUTE_FIELDS = ["engine", "why", "state", "setting"];

async function route({ fresh = false } = {}) {
  if (!onDevice) return { engine: "server", why: "edition" };
  const settings = await getSettings();
  const { account } = await local.get("account");
  let state = "unavailable";
  try {
    state = (await onDevice.status({ fresh })).state;
  } catch {
    /* treated as unavailable */
  }
  const setting = ["auto", "device", "server"].includes(settings.engine) ? settings.engine : "auto";
  let r;
  if (setting === "server") r = { engine: "server", why: "setting" };
  else if (setting === "auto" && account?.licensed) r = { engine: "server", why: "plan" };
  else if (state !== "available") r = { engine: "server", why: state };
  else r = { engine: "device", why: setting };
  const next = { ...r, state, setting };
  if (!lastRoute || ROUTE_FIELDS.some((k) => lastRoute[k] !== next[k])) {
    lastRoute = next;
    await local.set({ deviceRoute: next });
    updateBadge(account);
  }
  return next;
}

// What a person is told when this computer could not write a draft and the
// server did instead.
function fallbackNote(err) {
  switch (err?.code) {
    case "language":
      return "The on-device AI doesn't write this language, so the XAICG server wrote it.";
    case "not_ready":
      return "The on-device AI isn't set up yet, so the XAICG server wrote it.";
    case "unavailable":
      return "The on-device AI isn't available, so the XAICG server wrote it.";
    default:
      return "The on-device AI couldn't write this one, so the XAICG server did.";
  }
}

async function generateOnDevice(body) {
  const input = { kind: body.kind, options: body.options, recent: body.recent, rejected: body.rejected };
  if (body.post) input.post = body.post;
  if (body.idea) input.idea = body.idea;
  if (body.draft) input.draft = body.draft;
  const out = await onDevice.generate(input);
  const { account } = await local.get("account");
  return { kind: body.kind, ...out, account: account || null, engine: "device" };
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
  // server uses it only to stop the free allowance being reset by reinstalling.
  // The hash is remembered so requests from the popup, which has no X page
  // to read the handle from, carry the same identity.
  if (payload.handle) {
    body.xh = await sha256Hex(String(payload.handle).toLowerCase().replace(/^@/, ""));
    await local.set({ xh: body.xh });
  } else {
    const { xh } = await local.get("xh");
    if (xh) body.xh = xh;
  }

  // Unlimited edition: on this computer when that is where the draft belongs.
  // If it cannot write this one, the server does, unless the person chose
  // "always on this computer".
  let fellBack = null;
  if (onDevice) {
    const r = await route();
    if (r.engine === "device") {
      try {
        return await generateOnDevice(body);
      } catch (err) {
        if (r.setting === "device") {
          const hint = err.code === "language" ? " It writes English, Spanish, German, French and Japanese." : "";
          throw new ApiError(`device_${err.code || "failed"}`, `${err.message || "The on-device AI couldn't write this."}${hint} To let the XAICG server write it, change "Where drafts are written" in Settings.`);
        }
        fellBack = err;
      }
    }
  }

  let result;
  try {
    result = await request("/v1/generate", { method: "POST", body });
  } catch (err) {
    // The server asks for a short pause between generations. Rather than
    // show an error for a quick second click, wait it out once.
    const pause = Number(err?.extra?.retryAfter) || 0;
    if (err?.code === "cooldown" && pause > 0 && pause <= 3) {
      await new Promise((resolve) => setTimeout(resolve, pause * 1000));
      result = await request("/v1/generate", { method: "POST", body });
    } else {
      throw err;
    }
  }
  if (fellBack) return { ...result, engine: "server", fallbackNote: fallbackNote(fellBack) };
  return result;
}

async function remember(text) {
  const clean = String(text || "").trim();
  if (!clean) return;
  const { recentReplies = [] } = await local.get("recentReplies");
  await local.set({ recentReplies: [clean, ...recentReplies.filter((r) => r !== clean)].slice(0, RECENT_MAX) });
}

/* ----------------------------- Google sign-in ---------------------------- */

// Signing in happens inside the extension. Chrome itself asks which Google
// account to use (chrome.identity) and hands this worker a short-lived
// access token. No tab is opened and no web page is involved. The token is
// sent to the XAICG server once, which checks with Google that it was issued
// to this extension and reads the account's id, name and email from it.
// Nothing is kept here afterwards: the token is dropped from Chrome's cache.
const GOOGLE_CLIENT = chrome.runtime.getManifest().oauth2?.client_id || "";
const GOOGLE_READY = /\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT) && !GOOGLE_CLIENT.startsWith("REPLACE_");

// Chrome reports sign-in problems as plain strings. Turn the ones a person
// can act on into something readable.
function googleError(err) {
  const text = String(err?.message || err || "");
  if (/did not approve|denied|cancel|closed/i.test(text)) return new ApiError("sign_in_cancelled", "Sign-in was cancelled.");
  if (/not signed in|turned off|sign.?in.*chrome/i.test(text)) {
    return new ApiError("chrome_signed_out", "Sign in to Chrome with your Google account first (the profile button at the top right of Chrome), then try again.");
  }
  if (/client id|oauth2|invalid_client|not granted/i.test(text)) {
    return new ApiError("google_not_configured", `Google sign-in is not set up correctly for this extension (${text}).`);
  }
  return new ApiError("google_sign_in_failed", `Google sign-in didn't work${text ? ` (${text})` : ""}. Try again.`);
}

async function googleToken() {
  if (!chrome.identity?.getAuthToken) throw new ApiError("unsupported_browser", "Signing in with Google needs Google Chrome.");
  if (!GOOGLE_READY) throw new ApiError("google_not_configured", "Google sign-in is not set up in this build of the extension.");
  try {
    const result = await chrome.identity.getAuthToken({ interactive: true });
    const token = typeof result === "string" ? result : result?.token;
    if (!token) throw new Error("Chrome returned no token");
    return token;
  } catch (err) {
    throw err instanceof ApiError ? err : googleError(err);
  }
}

const forgetToken = (token) => chrome.identity.removeCachedAuthToken({ token }).catch(() => {});

async function signIn() {
  let token = await googleToken();
  try {
    try {
      return await request("/v1/auth/google", { method: "POST", body: { accessToken: token } });
    } catch (err) {
      if (err.code !== "google_token_rejected") throw err;
      // Chrome hands out cached tokens, and a cached one can have gone stale.
      // Drop it and ask once more before giving up.
      await forgetToken(token);
      token = await googleToken();
      return await request("/v1/auth/google", { method: "POST", body: { accessToken: token } });
    }
  } finally {
    await forgetToken(token);
  }
}

async function signOut() {
  const result = await request("/v1/auth/signout", { method: "POST" });
  // Forget what Chrome cached, so the next sign-in starts clean.
  await chrome.identity?.clearAllCachedAuthTokens?.().catch(() => {});
  return result;
}

const handlers = {
  "xaicg:generate": (msg) => generate(msg.payload || {}),
  "xaicg:remember": async (msg) => {
    await remember(msg.text);
    return {};
  },
  "xaicg:account": async (msg) => ({ account: msg.refresh ? await refreshAccount() : await cachedAccount() }),
  "xaicg:activate": (msg) => request("/v1/license/activate", { method: "POST", body: { key: String(msg.key || ""), replaceOldest: msg.replaceOldest === true } }),
  "xaicg:deactivate": () => request("/v1/license/deactivate", { method: "POST" }),
  "xaicg:attach-license": (msg) => request("/v1/license/attach", { method: "POST", body: { replaceOldest: msg.replaceOldest === true } }),
  "xaicg:signin": () => signIn(),
  "xaicg:signout": () => signOut(),
  // Unlimited edition: whether this computer can write drafts, and where the
  // next one goes. `fresh` asks Chrome again instead of using the last answer.
  "xaicg:device": async (msg) => ({
    edition: EDITION,
    languages: onDevice?.languages || [],
    ...(await route({ fresh: msg.fresh === true })),
  }),
  "xaicg:clear-memory": async () => {
    await local.remove("recentReplies");
    return {};
  },
  "xaicg:info": async () => {
    const { deviceId } = await local.get("deviceId");
    return { deviceId: deviceId || null, apiBase: API_BASE, version: CLIENT_VERSION };
  },
  // The pricing page. The address comes from the server, so it is checked
  // before a tab is opened on it.
  "xaicg:open-plans": async () => {
    let url = "https://xaicg.uniquelabs.org/#pricing";
    try {
      const buy = new URL((await cachedAccount())?.links?.buy);
      if (buy.protocol === "https:") url = buy.href;
    } catch {}
    await chrome.tabs.create({ url });
    return {};
  },
  "xaicg:open-options": async (msg) => {
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
      if (!(err instanceof ApiError)) console.error("[XAICG]", err);
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
  if (onDevice) await route({ fresh: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  const { account } = await local.get("account");
  updateBadge(account);
  if (onDevice) await route({ fresh: true }).catch(() => {});
});

// Unlimited edition: a new plan, or a change to "Where drafts are written",
// can move drafts between this computer and the server.
if (onDevice) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.settings || changes.account)) route().catch(() => {});
  });
}
