// XAICG settings page: the on-device AI, the voice settings, and how
// drafts are delivered on x.com.

import { DEFAULT_SETTINGS } from "./config.js";
import { $, send } from "./lib/client.js";
import { deviceUi } from "./lib/device-ui.js";

let settings = { ...DEFAULT_SETTINGS };

/* -------------------------------- settings -------------------------------- */

let savedTimer;
function flashSaved() {
  const el = $("saved");
  el.textContent = "Saved";
  el.className = "status good";
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (el.textContent = ""), 1500);
}

async function save(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set({ settings });
  flashSaved();
}

function updatePersonaCount() {
  $("personaCount").textContent = `${$("persona").value.length} / 600`;
}

function fillSettings() {
  for (const id of ["tone", "length", "language", "emoji"]) $(id).value = settings[id];
  $("persona").value = settings.persona || "";
  $("showQuestionButton").checked = settings.showQuestionButton !== false;
  $("sfx").checked = settings.sfx !== false;
  if (globalThis.XAICG_SFX) globalThis.XAICG_SFX.enabled = settings.sfx !== false;
  document.querySelectorAll('input[name="outputMode"]').forEach((r) => (r.checked = r.value === (settings.outputMode === "clipboard" ? "clipboard" : "insert")));
  updatePersonaCount();
}

/* --------------------------------- wiring --------------------------------- */

for (const id of ["tone", "length", "language", "emoji"]) {
  $(id).addEventListener("change", () => save({ [id]: $(id).value }));
}
let personaTimer;
$("persona").addEventListener("input", () => {
  updatePersonaCount();
  clearTimeout(personaTimer);
  personaTimer = setTimeout(() => save({ persona: $("persona").value.trim().slice(0, 600) }), 400);
});
$("presets").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  $("persona").value = chip.dataset.persona || "";
  updatePersonaCount();
  save({ persona: $("persona").value });
});
document.querySelectorAll('input[name="outputMode"]').forEach((r) => r.addEventListener("change", () => r.checked && save({ outputMode: r.value })));
$("showQuestionButton").addEventListener("change", () => save({ showQuestionButton: $("showQuestionButton").checked }));
$("sfx").addEventListener("change", () => {
  const on = $("sfx").checked;
  if (globalThis.XAICG_SFX) globalThis.XAICG_SFX.enabled = on;
  // Switching sound on plays one, so it is clear what was just turned on.
  if (on) globalThis.XAICG_SFX?.play("done");
  save({ sfx: on });
});
$("clearMemory").addEventListener("click", async () => {
  await send("xaicg:clear-memory");
  $("memoryStatus").textContent = "Reply memory cleared.";
  setTimeout(() => ($("memoryStatus").textContent = ""), 2000);
});

(async function init() {
  const stored = await chrome.storage.local.get(["settings"]);
  settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  // A language earlier versions offered and the on-device AI does not write.
  if (!["en", "es", "de", "fr", "ja", "auto"].includes(settings.language)) settings.language = "en";
  fillSettings();

  $("version").textContent = chrome.runtime.getManifest().version;
  if (location.hash === "#welcome") $("welcome").hidden = false;

  await deviceUi
    .mount($("device"), {
      variant: "options",
      onState: ({ state }) => {
        $("welcomeSetup").hidden = state !== "downloadable";
      },
    })
    .catch(() => {});
  if (location.hash === "#device") $("device").scrollIntoView({ block: "start" });
})();
