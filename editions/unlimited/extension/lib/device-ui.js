// XAICG Unlimited: the "on this computer" card in the popup and the settings
// page. It says whether Chrome's built-in AI can write drafts here, sets it up
// (a one-time download that Chrome does itself), and, on the settings page,
// lets the person choose where drafts are written.
//
// The download is started here, in a page, rather than in the service worker,
// because Chrome may only start it after a person's click.

import { send } from "./client.js";

const LANGUAGES = "English, Spanish, German, French and Japanese";
const SETUP_LANGUAGES = ["en", "es", "de", "fr", "ja"];

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

// Ask Chrome for the model, with the languages XAICG uses. Chrome downloads
// whatever is missing and reports progress from 0 to 1. A computer that can
// run the model but not every language still gets English.
async function setUp(onProgress) {
  const LM = globalThis.LanguageModel;
  if (!LM?.create) throw new Error("This version of Chrome doesn't offer its built-in AI to extensions. Update Chrome, then try again.");
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
  if (name === "QuotaExceededError" || /space|storage/i.test(err?.message || "")) return "There isn't enough free disk space. Chrome needs about 22 GB free.";
  return err?.message || "Setting up didn't work. Try again.";
}

// The words for each state. `variant` is "popup" (short) or "options".
function words(info, variant) {
  const popup = variant === "popup";
  if (info.engine === "device") {
    return {
      tone: "on",
      title: "Unlimited comments",
      text: popup
        ? "Written on this computer by Chrome's built-in AI. No daily limit."
        : `Drafts are written on this computer by Chrome's built-in AI (Gemini Nano). There is no daily limit, and the post you answer never leaves your computer. It writes ${LANGUAGES}; anything else goes to the XAICG server.`,
    };
  }
  switch (info.state) {
    case "available":
      return info.why === "plan"
        ? { tone: "ready", title: "On this computer: ready", text: popup ? "Your plan's drafts come from the XAICG server. To make them unlimited, choose this computer in Settings." : "You have a plan, so drafts come from the XAICG server, which writes the best ones. Choose \"Always on this computer\" below to write unlimited drafts here instead." }
        : { tone: "ready", title: "On this computer: ready", text: popup ? "You chose the XAICG server in Settings, so drafts count against your daily allowance." : "You chose the XAICG server, so drafts count against your daily allowance. Choose \"Automatic\" to write them here, without a limit." };
    case "downloadable":
      return {
        tone: "setup",
        title: "Turn on unlimited comments",
        text: popup
          ? "Chrome can write drafts on this computer, with no daily limit. It needs a one-time download."
          : "Chrome can write drafts on this computer with its built-in AI, with no daily limit and nothing sent anywhere. It needs a one-time download of the AI model from Google, which can take a few minutes. Until then, drafts come from the XAICG server.",
        action: "Set up",
      };
    case "downloading":
      return {
        tone: "setup",
        title: "Setting up…",
        text: "Chrome is downloading its built-in AI. This can take a few minutes, and it carries on in the background. Until it's done, drafts come from the XAICG server.",
        action: "Check again",
      };
    case "unsupported":
      return {
        tone: "off",
        title: "Update Chrome for unlimited comments",
        text: "This version of Chrome doesn't offer its built-in AI to extensions. Update Chrome (Settings, then About Chrome), then open XAICG again. Until then, drafts come from the XAICG server.",
      };
    default:
      return {
        tone: "off",
        title: "Not available on this computer",
        text: popup
          ? "Chrome's built-in AI can't run here, so drafts come from the XAICG server."
          : "Chrome's built-in AI can't run on this computer, so drafts come from the XAICG server. It needs desktop Chrome on Windows, macOS, Linux or a Chromebook Plus, about 22 GB of free disk space, and either a graphics card with more than 4 GB of memory or 16 GB of memory and 4 processor cores.",
      };
  }
}

const ENGINE_CHOICES = [
  ["auto", "Automatic", "On this computer, unlimited. With a plan, the XAICG server instead."],
  ["device", "Always on this computer", `Unlimited and private, even with a plan. ${LANGUAGES} only.`],
  ["server", "Always the XAICG server", "The best drafts, in every language. Counted against your daily allowance."],
];

export const deviceUi = {
  // card: an empty, hidden <section>. onRoute(info) is called whenever it
  // learns where drafts are going. On the settings page, `settings` and
  // `save(patch)` let it change "Where drafts are written".
  async mount(card, { variant = "popup", onRoute = () => {}, settings = null, save = null } = {}) {
    let info = null;
    let busy = false;
    let progress = null;
    let message = "";

    const paint = () => {
      if (!info) return;
      const w = words(info, variant);
      const parts = [
        h("div", { class: "device-head" },
          h("span", { class: `device-dot ${w.tone}`, "aria-hidden": "true" }),
          h(variant === "popup" ? "strong" : "h2", { class: "device-title" }, w.title)),
        h("p", { class: "muted device-text" }, w.text),
      ];
      if (progress != null) {
        const bar = h("div", { class: "bar device-bar", role: "progressbar", "aria-label": "Download", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(progress * 100)) }, h("i"));
        bar.firstChild.style.width = `${Math.max(2, Math.round(progress * 100))}%`;
        parts.push(bar, h("p", { class: "muted small" }, progress >= 1 ? "Downloaded. Getting it ready…" : `Downloading ${Math.round(progress * 100)}%. ${variant === "popup" ? "Keep this open until it finishes, or set it up from Settings." : "You can keep using XAICG meanwhile."}`));
      }
      if (w.action) {
        parts.push(h("div", { class: "device-actions" }, h("button", { class: "btn primary sm", type: "button", disabled: busy, onclick: start }, busy ? "Setting up…" : w.action)));
      }
      if (message) parts.push(h("p", { class: "status error", role: "status" }, message));

      if (variant === "options" && settings && save) {
        const current = settings.engine || "auto";
        parts.push(
          h("fieldset", { class: "device-engine" },
            h("legend", { class: "label" }, "Where drafts are written"),
            ENGINE_CHOICES.map(([value, label, hint]) =>
              h("label", { class: "choice" },
                h("input", { type: "radio", name: "engine", value, checked: current === value, onchange: () => choose(value) }),
                " ",
                h("span", null, h("b", null, label), h("br"), h("span", { class: "muted small" }, hint))))),
        );
      }
      card.className = `card device ${variant} ${w.tone}`;
      card.replaceChildren(...parts);
      card.hidden = false;
    };

    const refresh = async (fresh = false) => {
      try {
        info = await send("xaicg:device", { fresh });
      } catch {
        info = info || { engine: "server", state: "unavailable", why: "unavailable" };
      }
      paint();
      edition(info);
      onRoute(info);
    };

    // The parts of the page that are the same in both editions but should
    // read differently in this one.
    function edition(info) {
      const tagline = document.querySelector(".brand small");
      if (tagline) tagline.textContent = "Unlimited edition · AI replies for X";
      const about = document.getElementById("aboutData");
      if (about) {
        about.textContent =
          "Quote your install ID when contacting support. Drafts written on this computer stay on it: the post and the draft are not sent anywhere. Drafts written by the XAICG server send the text of the post you are replying to, and your settings above, to the server. XAICG never posts for you and does not read your messages or account data.";
      }
      const step = document.getElementById("welcomeSignIn");
      if (step && info.state === "downloadable") {
        step.replaceChildren(Object.assign(document.createElement("b"), { textContent: "One step first:" }), " press Set up below to turn on unlimited comments on this computer.");
        step.hidden = false;
      }
    }

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

    async function choose(engine) {
      settings.engine = engine;
      await save({ engine });
      await refresh();
    }

    // The settings page's "#device" link lands here.
    await refresh(true);
    return { refresh };
  },
};
