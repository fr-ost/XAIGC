// Helpers shared by the popup and the options page.

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

// Turn the account object from the server into display strings.
export function describeAccount(account) {
  if (!account) return null;
  const q = account.quota || { limit: 0, used: 0, remaining: 0, scope: "trial" };
  const pct = q.limit ? Math.min(100, Math.round((q.used / q.limit) * 100)) : 100;
  const trial = !account.licensed;
  let notice = "";
  const signInRequired = Boolean(account.auth?.signInRequired);
  if (signInRequired) notice = "Sign in with Google to start your free trial.";
  else if (account.notice === "license_expired") notice = "Your license has expired. Renew it to keep generating.";
  else if (account.notice === "license_revoked") notice = "Your license is no longer active. Contact support if that's unexpected.";
  else if (trial && account.accountLicense) notice = "Your account has a license that is not on this browser. Open Settings to use it here.";
  else if (trial && q.remaining === 0) notice = "Your free trial is used up. Activate a license to keep generating.";
  else if (!trial && q.remaining === 0) notice = "You've reached today's limit. It resets at 00:00 UTC.";

  return {
    trial,
    badge: account.planLabel || (trial ? "Free trial" : "Licensed"),
    badgeClass: account.notice ? "alert" : trial ? "" : "pro",
    left: q.remaining,
    label: trial ? `of ${q.limit} trial generations left` : `of ${q.limit} left today`,
    sub: trial ? "" : "Resets at 00:00 UTC",
    pct,
    barClass: pct >= 90 ? "bad" : pct >= 70 ? "warn" : "",
    notice,
    signInRequired,
    buyUrl: account.links?.buy || "https://xaicg.uniquelabs.org/#pricing",
    supportUrl: account.links?.support || "https://uniquelabs.org",
  };
}

export function renderAccount(account, { badge, left, label, sub, bar, notice }) {
  const d = describeAccount(account);
  if (!d) return null;
  badge.textContent = d.badge;
  badge.className = `badge ${d.badgeClass}`.trim();
  left.textContent = String(d.left);
  label.textContent = d.label;
  if (sub) sub.textContent = d.sub;
  bar.className = `bar ${d.barClass}`.trim();
  bar.firstElementChild.style.width = `${d.pct}%`;
  if (notice) {
    notice.textContent = d.notice;
    notice.hidden = !d.notice;
  }
  return d;
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
