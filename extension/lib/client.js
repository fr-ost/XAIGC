// Helpers shared by the popup and the settings page.

export async function send(type, data = {}) {
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type, ...data });
  } catch {
    res = null;
  }
  if (!res) throw Object.assign(new Error("XAICG is restarting. Close this and try again."), { code: "context" });
  if (!res.ok) {
    const { message, ...rest } = res.error || {};
    throw Object.assign(new Error(message || "Something went wrong."), rest);
  }
  return res.data;
}

export const $ = (id) => document.getElementById(id);

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
