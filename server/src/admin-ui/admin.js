// XAICG admin dashboard. Plain DOM, no framework, no inline script (strict CSP).
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = { token: sessionStorage.getItem("xaicg_admin") || "" };
  const LABELS = { reply: "Replies", question: "Questions", quote: "Quotes", post: "Posts", thread: "Threads", rewrite: "Rewrites" };

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const fmt = (n) => Number(n || 0).toLocaleString();
  const shortDay = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

  async function api(path) {
    const res = await fetch(`/admin/api${path}`, { headers: { Authorization: `Bearer ${state.token}` } });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* empty or non-JSON body */
    }
    if (!res.ok) {
      const err = new Error(json?.error?.message || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  function showSignedIn(on) {
    $("signIn").hidden = on;
    $("app").hidden = !on;
    $("refresh").hidden = !on;
    $("signOut").hidden = !on;
    if (!on) $("callerTag").hidden = true;
  }

  function signOut(message) {
    state.token = "";
    sessionStorage.removeItem("xaicg_admin");
    showSignedIn(false);
    $("signInError").textContent = message || "";
    $("token").value = "";
    $("token").focus();
  }

  function render(s) {
    $("callerTag").textContent = `You: ${s.caller.address} via ${s.caller.source}`;
    $("callerTag").title = "How the server sees your address. If this is a private proxy address rather than your public IP, set CLIENT_IP_HEADER for this host.";
    $("callerTag").hidden = false;

    const stat = (label, value, sub) => h("div", { class: "stat" }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "sub" }, sub));
    $("stats").replaceChildren(
      stat("Users (installs)", fmt(s.installs.total), `${fmt(s.installs.new24h)} new today · ${fmt(s.installs.new7d)} this week`),
      stat("Active users", fmt(s.installs.active7d), `in the last 7 days · ${fmt(s.installs.active24h)} today · ${fmt(s.installs.active30d)} this month`),
      stat("Comments today", fmt(s.today.drafts), `${fmt(s.drafts.last7d)} in the last 7 days`),
      stat("Comments, all time", fmt(s.drafts.total), `${fmt(s.installs.writers)} installs have written at least one`),
    );

    // A bar per day, oldest on the left.
    const days = [...s.days].reverse();
    const max = Math.max(1, ...days.map((d) => d.drafts));
    $("chart").replaceChildren(
      ...days.map((d) => {
        const bar = h("span", { class: "bar", title: `${shortDay(d.day)}: ${fmt(d.drafts)} comments, ${fmt(d.installs)} new installs` });
        bar.style.height = `${Math.max(2, Math.round((d.drafts / max) * 100))}%`;
        return bar;
      }),
    );

    $("daysTable").querySelector("thead tr").replaceChildren(
      h("th", null, "Day"),
      h("th", { class: "num" }, "New installs"),
      h("th", { class: "num" }, "Comments"),
      ...s.kinds.map((k) => h("th", { class: "num" }, LABELS[k] || k)),
    );
    $("daysTable").querySelector("tbody").replaceChildren(
      ...s.days.map((d) =>
        h("tr", null,
          h("td", null, shortDay(d.day)),
          h("td", { class: "num" }, fmt(d.installs)),
          h("td", { class: "num" }, h("b", null, fmt(d.drafts))),
          ...s.kinds.map((k) => h("td", { class: "num muted" }, fmt(d.kinds[k])))),
      ),
    );

    $("versions").textContent = s.versions.length ? s.versions.map((v) => `${v.version}: ${fmt(v.installs)}`).join(" · ") : "No installs yet.";
  }

  async function load() {
    try {
      render(await api("/stats"));
      showSignedIn(true);
    } catch (err) {
      if (err.status === 401 || err.status === 429) signOut(err.message);
      else if (err.status === 404) signOut("The admin dashboard is disabled. Set ADMIN_TOKEN on the server.");
      else signOut(`Could not reach the server: ${err.message}`);
    }
  }

  $("signInForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.token = $("token").value.trim();
    sessionStorage.setItem("xaicg_admin", state.token);
    $("signInError").textContent = "";
    load();
  });
  $("refresh").addEventListener("click", load);
  $("signOut").addEventListener("click", () => signOut(""));

  if (state.token) load();
  else showSignedIn(false);
})();
