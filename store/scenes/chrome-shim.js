// Stand-in for the chrome.* extension APIs, used only by store/generate.mjs.
//
// It lets the real extension pages (popup.html, options.html) and the real
// content script run in an ordinary page, fed with the sample data in
// window.__XAICG_PREVIEW, so store screenshots show the actual UI without a
// server, a Chrome profile or an X account.
(() => {
  const preview = window.__XAICG_PREVIEW || {};
  const store = { ...(preview.storage || {}) };
  const listeners = [];
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  const local = {
    async get(keys) {
      if (keys == null) return clone(store);
      const names = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of names) if (store[k] !== undefined) out[k] = clone(store[k]);
      return out;
    },
    async set(values) {
      const changes = {};
      for (const [k, v] of Object.entries(values)) {
        changes[k] = { oldValue: store[k], newValue: v };
        store[k] = clone(v);
      }
      listeners.forEach((fn) => fn(changes, "local"));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete store[k];
    },
  };

  const replies = preview.replies || {};
  // preview.device: whether the on-device AI is ready ({ state }).
  // "available" unless a preview says otherwise.
  async function handle(message) {
    switch (message.type) {
      case "xaicg:device":
        return { state: "available", languages: ["en", "es", "de", "fr", "ja"], ...(preview.device || {}) };
      case "xaicg:info":
        return { version: preview.version };
      case "xaicg:generate": {
        const kind = message.payload?.kind || "reply";
        await new Promise((r) => setTimeout(r, 30));
        return kind === "thread" ? { kind, thread: replies.thread } : { kind, variants: replies[kind] || replies.reply };
      }
      default:
        return {};
    }
  }

  window.chrome = {
    runtime: {
      id: "xaicg-preview",
      getManifest: () => ({ version: preview.version || "0.0.0" }),
      getURL: (p) => p,
      openOptionsPage() {},
      sendMessage: async (message) => ({ ok: true, data: await handle(message) }),
      onMessage: { addListener() {} },
    },
    storage: { local, session: local, sync: local, onChanged: { addListener: (fn) => listeners.push(fn) } },
    tabs: { create: async () => ({ id: 1 }) },
  };
})();
