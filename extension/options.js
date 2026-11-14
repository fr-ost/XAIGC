// XAICG options page: license activation and voice settings.

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

  showSignIn(account);

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
  $("buy").hidden = account.licensed || Boolean(account.accountLicense);
  // The box below already explains a waiting account license; don't also say "activate a license".
  if (account.accountLicense) $("notice").hidden = true;
  $("buy").href = d.buyUrl;
  $("buy").textContent = account.notice === "license_expired" ? "Renew license" : "Get a license";
  $("support").href = d.supportUrl;
}

// The account card (Google sign-in) and the "your account has a license"
// prompt. Hidden entirely when the server has no Google sign-in configured.
function showSignIn(account) {
  const auth = account.auth || {};
  const user = account.user;
  $("account").hidden = !auth.google && !user;
  $("signedOut").hidden = Boolean(user);
  $("signedIn").hidden = !user;
  $("welcomeSignIn").hidden = !auth.signInRequired;
  if (user) {
    $("userName").textContent = user.name || user.email;
    $("userEmail").textContent = user.name ? user.email : "";
    $("avatar").textContent = (user.name || user.email).trim().charAt(0);
  } else {
    $("signInWhy").textContent = auth.signInRequired
      ? "Sign in with Google to start your free trial. Your trial and any license then follow your account to every browser you sign in on."
      : "Signing in is optional. It keeps your license with your Google account, so a new browser only needs you to sign in.";
  }

  showAccountLicense(account.accountLicense);
}

// A license that belongs to the signed-in account but is not on this browser.
// Taking a free seat needs no warning. Taking a seat from another browser is
// only ever done after the text says so and the user clicks again.
let attachReplaces = false;
function showAccountLicense(waiting, forceFull = false) {
  $("accountLicenseBox").hidden = !waiting;
  if (!waiting) return;
  const full = forceFull || waiting.reason === "device_limit";
  attachReplaces = full;
  $("accountLicenseText").textContent = full
    ? `Your account has a ${waiting.plan} license, but every one of its ${waiting.maxDevices} seat${waiting.maxDevices === 1 ? " is" : "s are"} in use. You can move it here: the browser that has been idle longest will lose it.`
    : `Your account has a ${waiting.plan} license that is not in use on this browser.`;
  $("attachLicense").textContent = full ? "Move the license to this browser" : "Use it on this browser";
}

function setSignInStatus(message, kind = "") {
  const el = $("signInStatus");
  el.textContent = message;
  el.className = `status ${kind}`.trim();
}

async function loadAccount(refresh) {
  try {
    const { account } = await send("xaicg:account", { refresh });
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
    const { account } = await send("xaicg:activate", { key, replaceOldest });
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
    const { account } = await send("xaicg:deactivate");
    showAccount(account);
    setLicenseStatus("License removed from this browser.");
  } catch (err) {
    setLicenseStatus(err.message, "error");
  }
});

$("googleSignIn").addEventListener("click", async () => {
  $("googleSignIn").disabled = true;
  setSignInStatus("Waiting for Google…");
  try {
    // Chrome shows its own account prompt; nothing opens in a tab.
    const { account } = await send("xaicg:signin");
    showAccount(account);
    setSignInStatus("You're signed in.", "good");
  } catch (err) {
    setSignInStatus(err.message, err.code === "sign_in_cancelled" ? "" : "error");
  } finally {
    $("googleSignIn").disabled = false;
  }
});
$("signOut").addEventListener("click", async () => {
  try {
    const { account } = await send("xaicg:signout");
    showAccount(account);
    setSignInStatus("Signed out.");
  } catch (err) {
    setSignInStatus(err.message, "error");
  }
});
$("attachLicense").addEventListener("click", async () => {
  $("attachLicense").disabled = true;
  try {
    const { account } = await send("xaicg:attach-license", { replaceOldest: attachReplaces });
    showAccount(account);
    setLicenseStatus(`License active on this browser. You're on ${account.planLabel}.`, "good");
  } catch (err) {
    if (err.code === "device_limit") {
      // The seats filled up since this page was drawn. Explain, and let the
      // next click be the one that moves it.
      const { account } = await chrome.storage.local.get("account");
      showAccountLicense({ ...(account?.accountLicense || {}), plan: account?.accountLicense?.plan || "", maxDevices: err.maxDevices }, true);
      setLicenseStatus(err.message, "error");
    } else {
      setLicenseStatus(err.message, "error");
    }
  } finally {
    $("attachLicense").disabled = false;
  }
});

// Keep the page in step with the account when it changes elsewhere (the
// popup, another settings tab, a generation on x.com).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.account?.newValue) showAccount(changes.account.newValue);
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
  await send("xaicg:clear-memory");
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
  if (location.hash === "#account") $("account").scrollIntoView({ block: "start" });

  loadAccount(true);
  try {
    const info = await send("xaicg:info");
    $("deviceId").textContent = info.deviceId || "Not registered yet";
  } catch {
    $("deviceId").textContent = "Unavailable";
  }
})();
