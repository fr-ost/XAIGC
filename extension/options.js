// XAIGC options page: license activation and voice settings.

import { DEFAULT_SETTINGS } from "./config.js";
import { $, renderAccount, send } from "./lib/client.js";

let settings = { ...DEFAULT_SETTINGS };
let pendingKey = "";

/* -------------------------------- account -------------------------------- */

function setLicenseStatus(message, kind = "") {
  const el = $("licenseStatus");
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

  const lic = account.license;
  $("licenseInfo").hidden = !lic;
  if (lic) {
    $("licHint").textContent = lic.hint;
    $("licPlan").textContent = `${lic.plan}${lic.state === "active" ? "" : ` (${lic.state})`}`;
    $("licExpires").textContent = lic.expiresAt
      ? new Date(lic.expiresAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
      : "No expiry";
    $("licDevices").textContent = `${lic.devicesUsed} of ${lic.maxDevices} in use`;
  }
  $("deactivate").hidden = !lic;
  // Keep the key field available on trial and when a license needs replacing.
  $("activateForm").hidden = account.licensed;
  $("buy").hidden = account.licensed;
  $("buy").href = d.buyUrl;
  $("buy").textContent = account.notice === "license_expired" ? "Renew license" : "Get a license";
  $("support").href = d.supportUrl;
}

async function loadAccount(refresh) {
  try {
    const { account } = await send("xaigc:account", { refresh });
    showAccount(account);
    return account;
  } catch (err) {
    setLicenseStatus(err.message, "error");
    return null;
  }
}

async function activate(replaceOldest = false) {
  const key = replaceOldest ? pendingKey : $("licenseKey").value.trim();
  if (!key) {
    setLicenseStatus("Enter your license key.", "error");
    $("licenseKey").focus();
    return;
  }
  const button = replaceOldest ? $("replace") : $("activate");
  button.disabled = true;
  $("replaceBox").hidden = true;
  setLicenseStatus("Checking…");
  try {
    const { account } = await send("xaigc:activate", { key, replaceOldest });
    showAccount(account);
    $("licenseKey").value = "";
    pendingKey = "";
    setLicenseStatus(`License activated. You're on ${account.planLabel}.`, "good");
  } catch (err) {
    if (err.code === "device_limit" && err.canReplace) {
      pendingKey = key;
      $("replaceBox").hidden = false;
      setLicenseStatus(err.message, "error");
    } else {
      setLicenseStatus(err.message, "error");
    }
  } finally {
    button.disabled = false;
  }
}

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
  document.querySelectorAll('input[name="outputMode"]').forEach((r) => (r.checked = r.value === (settings.outputMode === "clipboard" ? "clipboard" : "insert")));
  updatePersonaCount();
}

/* --------------------------------- wiring --------------------------------- */

$("activateForm").addEventListener("submit", (e) => {
  e.preventDefault();
  activate(false);
});
$("replace").addEventListener("click", () => activate(true));
$("refresh").addEventListener("click", async () => {
  setLicenseStatus("");
  if (await loadAccount(true)) setLicenseStatus("Up to date.", "good");
});
$("deactivate").addEventListener("click", async () => {
  if (!confirm("Remove the license from this browser? You can activate it again here or on another device.")) return;
  try {
    const { account } = await send("xaigc:deactivate");
    showAccount(account);
    setLicenseStatus("License removed from this browser.");
  } catch (err) {
    setLicenseStatus(err.message, "error");
  }
});

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
$("clearMemory").addEventListener("click", async () => {
  await send("xaigc:clear-memory");
  $("memoryStatus").textContent = "Reply memory cleared.";
  setTimeout(() => ($("memoryStatus").textContent = ""), 2000);
});

(async function init() {
  const stored = await chrome.storage.local.get(["settings", "account"]);
  settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  fillSettings();
  if (stored.account) showAccount(stored.account);

  $("version").textContent = chrome.runtime.getManifest().version;
  if (location.hash === "#welcome") $("welcome").hidden = false;
  if (location.hash === "#license") $("licenseKey").focus();

  loadAccount(true);
  try {
    const info = await send("xaigc:info");
    $("deviceId").textContent = info.deviceId || "Not registered yet";
  } catch {
    $("deviceId").textContent = "Unavailable";
  }
})();
