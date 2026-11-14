// XAIGC popup: account status and the compose studio (posts, threads, rewrites).

import { $, copy, renderAccount, send } from "./lib/client.js";

const MODES = {
  post: {
    label: "What's the post about?",
    placeholder: "A rough idea is enough. For example: shipping small things weekly beats one big launch.",
    button: "Generate posts",
    max: 1000,
  },
  thread: {
    label: "What's the thread about?",
    placeholder: "The point you want to make, plus any facts it should use.",
    button: "Generate thread",
    max: 1000,
  },
  rewrite: {
    label: "Your draft",
    placeholder: "Paste the post you want tightened up.",
    button: "Rewrite",
    max: 1200,
  },
};

// The popup closes whenever it loses focus, so its state lives in storage.
const state = { mode: "post", inputs: { post: "", thread: "", rewrite: "" }, tone: "", size: "medium", tweets: "5", result: null };
let buyUrl = "https://uniquelabs.org";

const persist = () => chrome.storage.local.set({ popupState: state });

function setStatus(message, kind = "") {
  const el = $("status");
  el.textContent = message;
  el.className = `status ${kind}`.trim();
}

function showAccount(account) {
  const d = renderAccount(account, {
    badge: $("planBadge"),
    left: $("quotaLeft"),
    label: $("quotaLabel"),
    sub: $("quotaSub"),
    bar: $("quotaBar"),
    notice: $("notice"),
  });
  if (!d) return;
  buyUrl = d.buyUrl;
  const upgrade = $("upgrade");
  upgrade.hidden = !d.trial || d.signInRequired;
  upgrade.href = buyUrl;
  $("signIn").hidden = !d.signInRequired;
}

function applyMode() {
  const mode = MODES[state.mode];
  document.querySelectorAll(".segmented button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
  $("inputLabel").textContent = mode.label;
  $("input").placeholder = mode.placeholder;
  $("input").maxLength = mode.max;
  $("input").value = state.inputs[state.mode] || "";
  $("generate").textContent = mode.button;
  $("sizeField").hidden = state.mode !== "post";
  $("tweetsField").hidden = state.mode !== "thread";
  $("tone").value = state.tone;
  $("size").value = state.size;
  $("tweets").value = state.tweets;
}

function renderResult() {
  const result = state.result;
  const section = $("results");
  const list = $("resultList");
  list.replaceChildren();
  if (!result || !result.items?.length) {
    section.hidden = true;
    return;
  }
  const isThread = result.kind === "thread";
  $("resultsTitle").textContent = isThread ? `Thread · ${result.items.length} posts` : result.kind === "rewrite" ? "Rewrites" : "Drafts";
  $("copyAll").hidden = !isThread;

  result.items.forEach((text) => {
    const li = document.createElement("li");
    const p = document.createElement("p");
    p.textContent = text;

    const foot = document.createElement("div");
    foot.className = "result-foot";
    const count = document.createElement("span");
    const length = Array.from(text).length;
    count.className = `count${length > 280 ? " over" : ""}`;
    count.textContent = `${length} / 280`;

    const actions = document.createElement("div");
    actions.className = "result-actions";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn sm";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      copyBtn.textContent = (await copy(text)) ? "Copied" : "Copy failed";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1400);
    });
    actions.appendChild(copyBtn);
    if (!isThread) {
      const open = document.createElement("a");
      open.className = "btn sm primary";
      open.textContent = "Open in X";
      open.target = "_blank";
      open.rel = "noopener";
      open.href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
      actions.appendChild(open);
    }
    foot.append(count, actions);
    li.append(p, foot);
    list.appendChild(li);
  });
  section.hidden = false;
}

async function generate() {
  const mode = state.mode;
  const text = $("input").value.trim();
  if (text.length < 3) {
    setStatus(mode === "rewrite" ? "Paste a draft first." : "Describe what it should be about.", "error");
    $("input").focus();
    return;
  }
  const payload = { kind: mode, tone: state.tone || undefined };
  if (mode === "rewrite") payload.draft = text;
  else payload.idea = text;
  if (mode === "post") payload.length = state.size;
  if (mode === "thread") payload.tweets = Number(state.tweets);

  const button = $("generate");
  button.disabled = true;
  setStatus("Writing…");
  try {
    const data = await send("xaigc:generate", { payload });
    state.result = { kind: data.kind, items: data.thread || data.variants || [] };
    showAccount(data.account);
    setStatus("");
    renderResult();
    persist();
    $("results").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    setStatus(err.message, "error");
    if (err.code === "trial_ended" || err.code === "daily_limit" || err.code === "sign_in_required") {
      const { account } = await chrome.storage.local.get("account");
      showAccount(account);
    }
  } finally {
    button.disabled = false;
  }
}

/* --------------------------------- wiring --------------------------------- */

document.querySelectorAll(".segmented button").forEach((b) =>
  b.addEventListener("click", () => {
    state.inputs[state.mode] = $("input").value;
    state.mode = b.dataset.mode;
    applyMode();
    setStatus("");
    persist();
  }),
);
$("input").addEventListener("input", () => {
  state.inputs[state.mode] = $("input").value;
  persist();
});
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
});
for (const [id, key] of [["tone", "tone"], ["size", "size"], ["tweets", "tweets"]]) {
  $(id).addEventListener("change", () => {
    state[key] = $(id).value;
    persist();
  });
}
$("generate").addEventListener("click", generate);
$("copyAll").addEventListener("click", async () => {
  const ok = await copy((state.result?.items || []).join("\n\n"));
  $("copyAll").textContent = ok ? "Copied" : "Copy failed";
  setTimeout(() => ($("copyAll").textContent = "Copy thread"), 1400);
});
$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
// Signing in happens on the settings page, where there is room to explain it.
$("signIn").addEventListener("click", () => send("xaigc:open-options", { section: "account" }).then(() => window.close(), () => {}));

(async function init() {
  const stored = await chrome.storage.local.get(["popupState", "account"]);
  if (stored.popupState) {
    Object.assign(state, stored.popupState);
    state.inputs = { post: "", thread: "", rewrite: "", ...(stored.popupState.inputs || {}) };
    if (!MODES[state.mode]) state.mode = "post";
  }
  applyMode();
  renderResult();
  if (stored.account) showAccount(stored.account);
  try {
    const { account } = await send("xaigc:account", { refresh: true });
    showAccount(account);
  } catch (err) {
    if (!stored.account) setStatus(err.message, "error");
  }
})();
