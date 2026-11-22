// XAICG service worker.
//
// Content scripts, the popup and the settings page send it messages. It adds
// the user's voice settings and their recent drafts, and has the on-device
// AI write the draft on this computer (lib/ondevice.js). There is no
// account, no limit and nothing to pay.
//
// The XAICG server is told two things, and nothing else: that this install
// exists, and that a draft of some kind (a reply, a post...) was written. It
// never receives the post, the draft or anything about the person, and the
// extension works the same when it cannot be reached.

import { API_BASE, CLIENT_VERSION, DEFAULT_SETTINGS } from "./config.js";
import { onDevice } from "./lib/ondevice.js";

const RECENT_MAX = 30;
const RECENT_SENT = 8;
const REQUEST_TIMEOUT_MS = 15_000;
const KINDS = ["reply", "question", "quote", "post", "thread", "rewrite"];

class XaicgError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const local = chrome.storage.local;

async function getSettings() {
  const { settings } = await local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

/* --------------------------- is the on-device AI ready? --------------------------- */

// Kept in storage (deviceStatus) so the buttons on x.com know without asking.
let lastState = null;

async function deviceStatus({ fresh = false } = {}) {
  let state = "unavailable";
  try {
    state = (await onDevice.status({ fresh })).state;
  } catch {
    /* treated as unavailable */
  }
  if (state !== lastState) {
    lastState = state;
    await local.set({ deviceStatus: { state, at: Date.now() } });
    updateBadge(state);
  }
  return { state, languages: onDevice.languages };
}

// A small "!" on the toolbar icon until the AI is set up, so a new user sees
// there is one step left.
function updateBadge(state) {
  try {
    chrome.action.setBadgeText({ text: state === "downloadable" ? "!" : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#f0b90b" });
  } catch {
    /* the badge is cosmetic */
  }
}

/* ------------------------- counting (no content) ------------------------- */

function randomId(bytes = 24) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// A random id for this install, made here and never linked to a person.
async function getInstallId() {
  const stored = (await local.get("installId")).installId;
  if (stored) return stored;
  const installId = randomId();
  await local.set({ installId });
  return installId;
}

async function call(path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", "X-XAIGC-Client": CLIENT_VERSION };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return res;
}

let registering = null;
// Tell the server this install exists. Once is enough; the token it returns
// is what later counts are sent with.
function register() {
  if (!registering) {
    registering = (async () => {
      const res = await call("/v1/devices", { body: { installId: await getInstallId() } });
      if (!res.ok) throw new Error(`register ${res.status}`);
      const { token } = await res.json();
      await local.set({ deviceToken: token });
      return token;
    })().finally(() => {
      registering = null;
    });
  }
  return registering;
}

// Count one draft of this kind. Best effort: a failure changes nothing for
// the person, and nothing is retried later.
async function countDraft(kind) {
  if (!KINDS.includes(kind)) return;
  try {
    let { deviceToken } = await local.get("deviceToken");
    if (!deviceToken) deviceToken = await register();
    let res = await call("/v1/usage", { body: { kind }, token: deviceToken });
    if (res.status === 401) {
      // The server no longer knows this token: register again, once.
      await local.remove("deviceToken");
      res = await call("/v1/usage", { body: { kind }, token: await register() });
    }
  } catch {
    /* offline, or the server is down: the draft was written all the same */
  }
}

/* --------------------------------- writing --------------------------------- */

// One draft at a time: the model runs on this computer, and several prompts
// at once would only make each one slower.
let queue = Promise.resolve();
function oneAtATime(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

async function generate(payload) {
  const settings = await getSettings();
  const kind = payload.kind;
  const input = {
    kind,
    options: {
      tone: payload.tone || settings.tone,
      persona: settings.persona,
      length: payload.length || settings.length,
      language: settings.language,
      emoji: settings.emoji,
    },
  };
  if (payload.post) input.post = payload.post;
  if (payload.idea) input.idea = String(payload.idea).slice(0, 1000);
  if (payload.draft) input.draft = String(payload.draft).slice(0, 1200);
  if (payload.tweets) input.options.tweets = payload.tweets;
  if (payload.rejected?.length) input.rejected = payload.rejected.slice(0, 4).map((s) => String(s).slice(0, 400));

  // Recent replies steer new drafts away from repeating them. They never
  // leave this computer.
  if (kind === "reply" || kind === "question" || kind === "quote") {
    const { recentReplies = [] } = await local.get("recentReplies");
    if (recentReplies.length) input.recent = recentReplies.slice(0, RECENT_SENT).map((s) => String(s).slice(0, 400));
  }

  let out;
  try {
    out = await oneAtATime(() => onDevice.generate(input));
  } catch (err) {
    // A setup problem changes what the popup and x.com should say.
    if (err?.code === "not_ready" || err?.code === "unavailable") deviceStatus({ fresh: true }).catch(() => {});
    throw new XaicgError(`device_${err?.code || "failed"}`, err?.message || "The on-device AI couldn't write this. Try again.");
  }
  countDraft(kind);
  return { kind, ...out };
}

async function remember(text) {
  const clean = String(text || "").trim();
  if (!clean) return;
  const { recentReplies = [] } = await local.get("recentReplies");
  await local.set({ recentReplies: [clean, ...recentReplies.filter((r) => r !== clean)].slice(0, RECENT_MAX) });
}

/* -------------------------------- messages -------------------------------- */

const handlers = {
  "xaicg:generate": (msg) => generate(msg.payload || {}),
  "xaicg:remember": async (msg) => {
    await remember(msg.text);
    return {};
  },
  // Whether the on-device AI is ready. `fresh` asks again instead
  // of using the last answer (for example right after setup).
  "xaicg:device": (msg) => deviceStatus({ fresh: msg.fresh === true }),
  "xaicg:clear-memory": async () => {
    await local.remove("recentReplies");
    return {};
  },
  "xaicg:info": async () => ({ version: CLIENT_VERSION }),
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
      if (!(err instanceof XaicgError)) console.error("[XAICG]", err);
      sendResponse({ ok: false, error: { code: err.code || "unexpected", message: err.message || "Something went wrong." } });
    });
  return true; // respond asynchronously
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html#welcome") });
  }
  // Earlier versions kept an account and a plan here. None of that is used now.
  await local.remove(["account", "accountAt", "deviceId", "xh", "deviceRoute"]).catch(() => {});
  await deviceStatus({ fresh: true }).catch(() => {});
  // Count the install. Best effort, like every count.
  const { deviceToken } = await local.get("deviceToken");
  if (!deviceToken) await register().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  deviceStatus({ fresh: true }).catch(() => {});
});
