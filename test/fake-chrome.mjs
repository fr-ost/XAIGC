// A stand-in for the chrome.* APIs and the XAICG counting server, enough to
// run the extension's real background.js in Node. Import it before background.js.

const store = {};
const changed = [];
const area = {
  async get(k) {
    if (k == null) return structuredClone(store);
    const keys = typeof k === "string" ? [k] : Array.isArray(k) ? k : Object.keys(k);
    return Object.fromEntries(keys.filter((x) => x in store).map((x) => [x, structuredClone(store[x])]));
  },
  async set(values) {
    const changes = {};
    for (const [k, v] of Object.entries(values)) {
      changes[k] = { oldValue: store[k], newValue: v };
      store[k] = structuredClone(v);
    }
    for (const fn of changed) fn(changes, "local");
  },
  async remove(k) {
    for (const x of [].concat(k)) delete store[x];
  },
};
const listeners = {};
const ev = (name) => ({ addListener: (fn) => (listeners[name] = fn) });

export const fake = {
  store,
  listeners,
  calls: [], // every request to the server: { path, body, headers }
  badge: [],
  tabs: [],
  serverDown: false,
  // Tokens the server has forgotten: /v1/usage answers 401 for them.
  forgotten: new Set(),
};

globalThis.chrome = {
  runtime: {
    id: "x",
    getManifest: () => ({ version: "4.0.0" }),
    getURL: (p) => `chrome-extension://x/${p}`,
    onMessage: ev("message"),
    onInstalled: ev("installed"),
    onStartup: ev("startup"),
  },
  storage: { local: area, onChanged: { addListener: (fn) => changed.push(fn) } },
  tabs: { create: async (t) => fake.tabs.push(t) },
  action: {
    setBadgeText: async ({ text }) => fake.badge.push(text),
    setBadgeBackgroundColor: async () => {},
  },
};

let tokens = 0;
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  const body = init.body ? JSON.parse(init.body) : null;
  fake.calls.push({ path, body, headers: init.headers || {} });
  if (fake.serverDown) throw new TypeError("Failed to fetch");
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data });
  if (path === "/v1/devices") return json(200, { token: `xd_${++tokens}`, deviceId: "d1", created: true });
  if (path === "/v1/usage") {
    const token = String(init.headers?.Authorization || "").replace(/^Bearer /, "");
    if (fake.forgotten.has(token)) return json(401, { error: { code: "unauthorized" } });
    return json(200, { ok: true, counted: true });
  }
  return json(404, { error: { code: "not_found" } });
};

// Send a message the way an extension page does, and wait for the answer.
export const send = (msg) =>
  new Promise((resolve) => {
    const kept = listeners.message(msg, { id: "x" }, resolve);
    if (kept !== true) resolve(undefined);
  });

export const reports = () => fake.calls.filter((c) => c.path === "/v1/usage");
// Counts are sent after the draft is returned; give them a moment.
export const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
