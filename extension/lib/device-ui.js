// The "on-device AI" card in the popup and the settings page. It says
// whether drafts can be written on this computer, and sets the AI up: a
// one-time download of the model.
//
// The download is started here, in a page, rather than in the service worker,
// because the browser may only start it after a person's click.

import { send } from "./client.js";

export const LANGUAGES = "English, Spanish, German, French and Japanese";
const SETUP_LANGUAGES = ["en", "es", "de", "fr", "ja"];
export const REQUIREMENTS =
  "It needs desktop Chrome on Windows, macOS, Linux or a Chromebook Plus, about 22 GB of free disk space, and either a graphics card with more than 4 GB of memory, or 16 GB of memory and 4 processor cores.";

function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value == null) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}

// Ask for the model, with the languages XAICG writes. Whatever is missing is
// downloaded, with progress reported from 0 to 1. A computer that can
// run the model but not every language still gets English.
async function setUp(onProgress) {
  const LM = globalThis.LanguageModel;
  if (!LM?.create) throw new Error("This version of Chrome can't run XAICG's on-device AI. Update Chrome, then try again.");
  const create = (languages) =>
    LM.create({
      expectedInputs: [{ type: "text", languages }],
      expectedOutputs: [{ type: "text", languages }],
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => onProgress(Number(e.loaded) || 0));
      },
    });
  let session;
  try {
    session = await create(SETUP_LANGUAGES);
  } catch (err) {
    if (err?.name !== "NotSupportedError") throw err;
    session = await create(["en"]);
  }
  session.destroy();
}

function setupError(err) {
  const name = err?.name || "";
  if (name === "NetworkError") return "The download stopped. Check your connection and press Set up again.";
  if (name === "NotAllowedError") return "Chrome didn't allow the download from here. Press Set up again.";
  if (name === "QuotaExceededError" || /space|storage/i.test(err?.message || "")) return "There isn't enough free disk space. XAICG needs about 22 GB free.";
  return err?.message || "Setting up didn't work. Try again.";
}

// The words for each state. `variant` is "popup" (short) or "options".
function words(state, variant) {
  const popup = variant === "popup";
  switch (state) {
    case "available":
      return {
        tone: "on",
        title: "Ready: free and unlimited",
        text: popup
          ? "Drafts are written privately on this computer. No limit, nothing to pay."
          : `Drafts are written on this computer by XAICG's on-device AI. There is no limit and nothing to pay, and the post you answer never leaves your computer. XAICG writes ${LANGUAGES}.`,
      };
    case "downloadable":
      return {
        tone: "setup",
        title: "One step left: set up the AI",
        text: popup
          ? "XAICG's AI runs on your computer. It needs a one-time download, then it's free and unlimited."
          : "XAICG writes with an AI model that runs on this computer. It needs a one-time download, which can take a few minutes. After that, drafts are free and unlimited, and nothing you write is sent anywhere.",
        action: "Set up",
      };
    case "downloading":
      return {
        tone: "setup",
        title: "Setting up…",
        text: "The AI model is downloading. This can take a few minutes and carries on in the background. XAICG can write as soon as it's done.",
        action: "Check again",
      };
    case "unsupported":
      return {
        tone: "off",
        title: "Update Chrome to use XAICG",
        text: "This version of Chrome can't run XAICG's on-device AI. Update Chrome (Settings, then About Chrome), then open XAICG again.",
      };
    default:
      return {
        tone: "off",
        title: "Not available on this computer",
        text: popup
          ? "XAICG's on-device AI can't run on this computer, so it can't write drafts here."
          : `XAICG's on-device AI can't run on this computer. ${REQUIREMENTS}`,
      };
  }
}

export const deviceUi = {
  // card: an empty, hidden <section>. onState(info) is called whenever the
  // card learns whether the on-device AI is ready ({ state, languages }).
  async mount(card, { variant = "popup", onState = () => {} } = {}) {
    let info = null;
    let busy = false;
    let progress = null;
    let message = "";

    const paint = () => {
      if (!info) return;
      const w = words(info.state, variant);
      const parts = [
        h("div", { class: "device-head" },
          h("span", { class: `device-dot ${w.tone}`, "aria-hidden": "true" }),
          h(variant === "popup" ? "strong" : "h2", { class: "device-title" }, w.title)),
        h("p", { class: "muted device-text" }, w.text),
      ];
      if (progress != null) {
        const pct = Math.round(progress * 100);
        const bar = h("div", { class: "bar device-bar", role: "progressbar", "aria-label": "Download", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) }, h("i"));
        bar.firstChild.style.width = `${Math.max(2, pct)}%`;
        parts.push(bar, h("p", { class: "muted small" }, progress >= 1 ? "Downloaded. Getting it ready…" : `Downloading ${pct}%. ${variant === "popup" ? "Keep this open until it finishes, or set it up from Settings." : "You can leave this page open and carry on."}`));
      }
      if (w.action) {
        parts.push(h("div", { class: "device-actions" }, h("button", { class: "btn primary sm", type: "button", disabled: busy, onclick: start }, busy ? "Setting up…" : w.action)));
      }
      if (message) parts.push(h("p", { class: "status error", role: "status" }, message));
      card.className = `card device ${variant} ${w.tone}`;
      card.replaceChildren(...parts);
      card.hidden = false;
    };

    const refresh = async (fresh = false) => {
      try {
        info = await send("xaicg:device", { fresh });
      } catch {
        info = info || { state: "unavailable", languages: [] };
      }
      paint();
      onState(info);
    };

    async function start() {
      if (busy) return;
      busy = true;
      message = "";
      progress = 0;
      paint();
      try {
        await setUp((loaded) => {
          progress = loaded;
          paint();
        });
        progress = null;
        globalThis.XAICG_SFX?.play("done");
      } catch (err) {
        progress = null;
        message = setupError(err);
        globalThis.XAICG_SFX?.play("error");
      } finally {
        busy = false;
        await refresh(true);
      }
    }

    await refresh(true);
    return { refresh };
  },
};
