// A stand-in for the chrome.* APIs and the XAICG server, enough to run the
// extension's real background.js in Node. Import it before background.js.

const store = {};
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
const changed = [];
const listeners = {};
const ev = (name) => ({ addListener: (fn) => (listeners[name] = fn) });

export const fake = {
  store,
  calls: [],
  badge: [],
  // What the server answers to /v1/generate and /v1/me.
  account: { plan: "free", planLabel: "Free", licensed: false, quota: { scope: "free", limit: 5, used: 0, remaining: 5 }, auth: { google: true, signInRequired: false }, user: null, links: {} },
};

globalThis.chrome = {
  runtime: {
    id: "x",
    getManifest: () => ({ version: "3.1.3", oauth2: { client_id: "1-a.apps.googleusercontent.com" } }),
    getURL: (p) => `chrome-extension://x/${p}`,
    onMessage: ev("message"),
    onInstalled: ev("installed"),
    onStartup: ev("startup"),
  },
  storage: { local: area, onChanged: { addListener: (fn) => changed.push(fn) } },
  tabs: { create: async () => ({}) },
  identity: {},
  action: {
    setBadgeText: async ({ text }) => fake.badge.push(text),
    setBadgeBackgroundColor: async () => {},
  },
};

globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  const body = init.body ? JSON.parse(init.body) : null;
  fake.calls.push({ path, body });
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data });
  if (path === "/v1/devices") return json(200, { token: "dt", deviceId: "d1", account: fake.account });
  if (path === "/v1/me") return json(200, { account: fake.account });
  if (path === "/v1/generate") {
    fake.account = { ...fake.account, quota: { ...fake.account.quota, used: fake.account.quota.used + 1, remaining: fake.account.quota.remaining - 1 } };
    return json(200, { kind: body.kind, variants: ["A draft from the server."], account: fake.account });
  }
  return json(404, { error: { code: "not_found", message: "nope" } });
};

// Send a message the way an extension page does, and wait for the answer.
export const send = (msg) =>
  new Promise((resolve) => {
    const kept = listeners.message(msg, { id: "x" }, resolve);
    if (kept !== true) resolve(undefined);
  });

export const serverGenerations = () => fake.calls.filter((c) => c.path === "/v1/generate").length;
