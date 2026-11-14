// XAICG admin dashboard. Plain DOM, no framework, no inline script (strict CSP).
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const PAGE = 50;
  const state = { token: sessionStorage.getItem("xaicg_admin") || "", offset: 0, total: 0, userOffset: 0, userTotal: 0, plans: [], openId: null, issueFor: null };

  // h("td", { class: "num" }, "text", childNode)
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
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");
  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
  const fmtCost = (usd) => (usd <= 0 ? "$0.00" : usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`);

  let toastTimer;
  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  async function copy(text, label = "Copied") {
    try {
      await navigator.clipboard.writeText(text);
      toast(label);
    } catch {
      toast("Copy failed. Select the text and copy it manually.");
    }
  }

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(`/admin/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${state.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
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

  /* ------------------------------ session -------------------------------- */

  function showSignedIn(on) {
    $("signIn").hidden = on;
    $("app").hidden = !on;
    $("refresh").hidden = !on;
    $("signOut").hidden = !on;
    if (!on) {
      $("modelTag").hidden = true;
      $("callerTag").hidden = true;
    }
  }

  function signOut(message) {
    state.token = "";
    sessionStorage.removeItem("xaicg_admin");
    showSignedIn(false);
    $("signInError").textContent = message || "";
    $("token").value = "";
    $("token").focus();
  }

  async function start() {
    try {
      const [{ plans }] = await Promise.all([api("/plans"), loadStats()]);
      state.plans = plans;
      const select = $("cPlan");
      select.replaceChildren(
        ...plans.map((p) => h("option", { value: p.id }, `${p.label} · ${p.dailyLimit}/day · ${p.maxDevices} device${p.maxDevices === 1 ? "" : "s"}`)),
      );
      showSignedIn(true);
      await Promise.all([loadUsers(), loadLicenses()]);
    } catch (err) {
      if (err.status === 401 || err.status === 429) signOut(err.message);
      else if (err.status === 404) signOut("The admin API is disabled. Set ADMIN_TOKEN on the server.");
      else signOut(`Could not reach the server: ${err.message}`);
    }
  }

  /* ------------------------------- stats --------------------------------- */

  async function loadStats() {
    const s = await api("/stats");
    $("modelTag").textContent = `Model: ${s.model}`;
    $("modelTag").hidden = false;
    $("callerTag").textContent = `You: ${s.caller.address} via ${s.caller.source}`;
    $("callerTag").title = "How the server sees your address. If this is a private proxy address rather than your public IP, set CLIENT_IP_HEADER for this host.";
    $("callerTag").hidden = false;

    const stat = (label, value, sub) => h("div", { class: "stat" }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "sub" }, sub));
    $("stats").replaceChildren(
      stat("Generations today", fmt(s.today.total), `${fmt(s.today.paid)} licensed · ${fmt(s.today.free)} free`),
      stat("Est. OpenAI cost today", s.priced ? fmtCost(s.today.costUsd) : "n/a", s.priced ? `${fmt(s.today.tokensIn + s.today.tokensOut)} tokens` : "Set PRICE_IN_PER_M / PRICE_OUT_PER_M"),
      stat("Active licenses", fmt(s.licenses.active), `${fmt(s.licenses.expired)} expired · ${fmt(s.licenses.revoked)} revoked`),
      stat("Installs", fmt(s.devices.total), `${fmt(s.devices.active24h)} active in 24h · ${fmt(s.devices.new24h)} new`),
      stat("Users", fmt(s.users.total), s.signIn.google ? `${fmt(s.users.new24h)} new today · ${fmt(s.users.active7d)} this week` : "Google sign-in is off"),
      stat("Licensed installs", fmt(s.devices.licensed), `${fmt(s.devices.blocked)} blocked`),
    );
    $("usersNote").textContent = !s.signIn.google
      ? "Google sign-in is not switched on, so nobody can sign up yet. Set GOOGLE_CLIENT_ID on the server to the client ID of your Chrome Extension OAuth client (the same one that is in the extension), then redeploy. No secret or public address is needed."
      : s.signIn.requiredForFree
        ? "Everyone on the free plan signs in with Google first, so they all appear here."
        : "Signing in is optional (FREE_REQUIRE_SIGN_IN=false), so only people who chose to sign in appear here.";

    $("capNote").textContent = s.free.dailyLimit > 0
      ? `Free plan: ${fmt(s.free.dailyLimit)} a day per person, up to ${fmt(s.caps.freeGlobalDaily)} a day across everyone · Cap on all generations: ${fmt(s.caps.globalDaily)} a day`
      : `The free plan is off (FREE_DAILY_LIMIT=0), so only licensed users can generate · Cap on all generations: ${fmt(s.caps.globalDaily)} a day`;
    const body = $("daysTable").querySelector("tbody");
    const rows = s.days.slice(0, 14).map((d) =>
      h("tr", null,
        h("td", null, d.day),
        h("td", { class: "num" }, fmt(d.total)),
        h("td", { class: "num" }, fmt(d.paid)),
        h("td", { class: "num" }, fmt(d.free)),
        h("td", { class: "num" }, fmt(d.tokensIn)),
        h("td", { class: "num" }, fmt(d.tokensOut)),
        h("td", { class: "num" }, s.priced ? fmtCost(d.costUsd) : "n/a"),
      ),
    );
    body.replaceChildren(...(rows.length ? rows : [h("tr", null, h("td", { class: "empty", colspan: "7" }, "No generations yet."))]));
    $("outcomes").textContent = s.outcomes24h.length
      ? `Outcomes in the last 24h: ${s.outcomes24h.map((o) => `${o.status} ${fmt(o.count)}`).join(" · ")}`
      : "";
  }

  /* ------------------------------ licenses ------------------------------- */

  const pill = (stateName, label = stateName) => h("span", { class: `pill ${stateName}` }, label);

  // Who a license is for: the account that owns it, else the email it was
  // issued to (waiting for that person to sign in), plus any note.
  function customerCell(l) {
    const who = l.owner?.email || l.email || "";
    const tag = l.owner ? h("span", { class: "pill active", title: "This Google account owns the license" }, "account") : l.email ? h("span", { class: "muted small" }, "not signed in yet") : null;
    return [who, who && tag ? " " : null, tag, who && l.note ? h("br") : null, l.note ? h("span", { class: "muted" }, l.note) : null];
  }

  /* -------------------------------- users --------------------------------- */

  async function loadUsers() {
    const q = $("userSearch").value.trim();
    const filter = $("userFilter").value;
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(state.userOffset) });
    if (q) params.set("q", q);
    if (filter) params.set("filter", filter);
    const { total, users } = await api(`/users?${params}`);
    state.userTotal = total;

    const rows = users.map((u) =>
      h("tr", null,
        h("td", { class: "wrap" }, u.email, u.name ? h("br") : null, u.name ? h("span", { class: "muted" }, u.name) : null),
        h("td", null, u.blocked ? pill("revoked", "blocked") : u.plan ? pill("active", u.plan) : `Free ${u.free.used}/${u.free.limit} today`),
        h("td", { class: "num" }, fmt(u.devices)),
        h("td", { class: "num" }, fmt(u.generations)),
        h("td", null, fmtDate(u.createdAt)),
        h("td", null, fmtDate(u.lastLoginAt)),
        h("td", null, h("button", { class: "btn sm", type: "button", onclick: () => openUser(u.id).catch((err) => toast(err.message)) }, "Manage")),
      ),
    );
    $("userTable").querySelector("tbody").replaceChildren(
      ...(rows.length ? rows : [h("tr", null, h("td", { class: "empty", colspan: "7" }, q || filter ? "No users match." : "No one has signed in yet."))]),
    );
    $("userCount").textContent = `(${fmt(total)})`;
    const from = total ? state.userOffset + 1 : 0;
    $("userPageInfo").textContent = `${from}-${Math.min(total, state.userOffset + PAGE)} of ${fmt(total)}`;
    $("userPrev").disabled = state.userOffset === 0;
    $("userNext").disabled = state.userOffset + PAGE >= total;
  }

  async function openUser(id) {
    const d = await api(`/users/${id}`);
    const u = d.user;
    $("dTitle").textContent = u.email;
    const refresh = () => Promise.all([openUser(id), loadUsers(), loadStats()]);
    const button = (label, fn, cls = "") =>
      h("button", {
        class: `btn sm ${cls}`,
        type: "button",
        onclick: async (e) => {
          const el = e.currentTarget;
          el.disabled = true;
          try {
            await fn();
          } catch (err) {
            toast(err.message);
          }
          el.disabled = false;
        },
      }, label);

    $("dBody").replaceChildren(
      h("div", { class: "kv" },
        kv("Status", u.blocked ? pill("revoked", "blocked") : pill("active")),
        kv("Plan", u.plan || `Free, ${u.free.used} of ${u.free.limit} used today`),
        kv("Name", u.name),
        kv("Generations", fmt(u.generations)),
        kv("Joined", fmtDateTime(u.createdAt)),
        kv("Last sign-in", fmtDateTime(u.lastLoginAt)),
        kv("Last active", fmtDateTime(u.lastSeenAt) || "Never"),
        u.blocked ? kv("Blocked because", u.blockedReason) : null,
      ),
      h("div", { class: "row-actions" },
        button("Issue a license to this user", async () => {
          $("detail").close();
          state.issueFor = { id: u.id, email: u.email };
          $("cEmail").value = u.email;
          $("issueCard").scrollIntoView({ behavior: "smooth", block: "start" });
          $("cPlan").focus({ preventScroll: true });
          toast("Choose a plan and press Create. It reaches their extension on their next click, if a seat is free.");
        }),
        u.blocked
          ? button("Unblock", async () => {
              await api(`/users/${id}/block`, { method: "POST", body: { blocked: false } });
              toast("User unblocked");
              await refresh();
            })
          : button("Block", async () => {
              const reason = prompt("Block this user on all of their browsers? Optional reason:", "");
              if (reason === null) return;
              await api(`/users/${id}/block`, { method: "POST", body: { blocked: true, reason: reason.trim() || undefined } });
              toast("User blocked");
              await refresh();
            }, "danger"),
        button("Delete user", async () => {
          const warning = u.blocked ? "\n\nThis user is BLOCKED. Deleting the account also deletes the block: they could sign up again. Keep blocked users instead." : "";
          if (!confirm(`Delete ${u.email}?\n\nErased: their Google account ID, name and email, including the email on their licenses, which become key-only. Their browsers are signed out.\n\nKept: today's free-use count (so deleting does not reset it) and anonymous usage records.${warning}`)) return;
          await api(`/users/${id}`, { method: "DELETE" });
          $("detail").close();
          toast("User deleted");
          await Promise.all([loadUsers(), loadLicenses(), loadStats()]);
        }, "danger"),
      ),
      h("div", null,
        h("h3", null, "Licenses"),
        h("div", { class: "table-wrap" },
          h("table", null,
            h("thead", null, h("tr", null, h("th", null, "Key"), h("th", null, "Plan"), h("th", null, "State"), h("th", { class: "num" }, "Devices"), h("th", null, "Expires"), h("th", null, ""))),
            h("tbody", null,
              d.licenses.length
                ? d.licenses.map((l) =>
                    h("tr", null,
                      h("td", { class: "mono" }, l.hint),
                      h("td", null, l.planLabel),
                      h("td", null, pill(l.state)),
                      h("td", { class: "num" }, `${l.devicesUsed}/${l.maxDevices}`),
                      h("td", null, l.expiresAt ? fmtDate(l.expiresAt) : l.durationDays ? `${l.durationDays}d after activation` : "Never"),
                      h("td", null, h("button", { class: "btn sm", type: "button", onclick: () => openDetail(l.id).catch((err) => toast(err.message)) }, "Manage")),
                    ),
                  )
                : h("tr", null, h("td", { class: "empty", colspan: "6" }, "No licenses. This user is on the free plan.")),
            ),
          ),
        ),
      ),
      h("div", null,
        h("h3", null, "Browsers signed in"),
        h("div", { class: "table-wrap" },
          h("table", null,
            h("thead", null, h("tr", null, h("th", null, "Install"), h("th", null, "License"), h("th", null, "Last seen"), h("th", null, "Version"), h("th", { class: "num" }, "Generations"))),
            h("tbody", null,
              d.devices.length
                ? d.devices.map((dev) =>
                    h("tr", null,
                      h("td", { class: "mono" }, dev.id.slice(0, 8), dev.blocked ? " (blocked)" : ""),
                      h("td", null, dev.license ? `${dev.license.plan}` : "None"),
                      h("td", null, fmtDateTime(dev.lastSeenAt)),
                      h("td", null, dev.clientVersion || ""),
                      h("td", { class: "num" }, fmt(dev.totalGenerations)),
                    ),
                  )
                : h("tr", null, h("td", { class: "empty", colspan: "5" }, "Signed out everywhere.")),
            ),
          ),
        ),
      ),
    );
    if (!$("detail").open) $("detail").showModal();
  }

  async function loadLicenses() {
    const q = $("search").value.trim();
    const status = $("statusFilter").value;
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(state.offset) });
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    const { total, licenses } = await api(`/licenses?${params}`);
    state.total = total;

    const rows = licenses.map((l) =>
      h("tr", null,
        h("td", { class: "mono" }, l.hint),
        h("td", null, l.planLabel),
        h("td", null, pill(l.state)),
        h("td", { class: "wrap" }, customerCell(l)),
        h("td", { class: "num" }, `${l.devicesUsed}/${l.maxDevices}`),
        h("td", { class: "num" }, `${fmt(l.usedToday)}/${fmt(l.dailyLimit)}`),
        h("td", null, l.expiresAt ? fmtDate(l.expiresAt) : l.durationDays ? `${l.durationDays}d after activation` : "Never"),
        h("td", null, fmtDate(l.createdAt)),
        h("td", null, h("button", { class: "btn sm", type: "button", onclick: () => openDetail(l.id) }, "Manage")),
      ),
    );
    $("licenseTable").querySelector("tbody").replaceChildren(
      ...(rows.length ? rows : [h("tr", null, h("td", { class: "empty", colspan: "9" }, q || status ? "No licenses match." : "No licenses yet. Issue the first one above."))]),
    );
    $("licenseCount").textContent = `(${fmt(total)})`;
    const from = total ? state.offset + 1 : 0;
    $("pageInfo").textContent = `${from}-${Math.min(total, state.offset + PAGE)} of ${fmt(total)}`;
    $("prevPage").disabled = state.offset === 0;
    $("nextPage").disabled = state.offset + PAGE >= total;
  }

  /* -------------------------------- create -------------------------------- */

  function syncValidity() {
    const mode = $("cValidity").value;
    $("cDaysField").hidden = mode !== "days";
    $("cDateField").hidden = mode !== "date";
  }

  async function createLicenses(event) {
    event.preventDefault();
    $("createError").textContent = "";
    const mode = $("cValidity").value;
    const body = { plan: $("cPlan").value, count: Number($("cCount").value) || 1 };
    const email = $("cEmail").value.trim();
    // Coming from "Issue a license to this user": send the account itself,
    // so the license goes to exactly that user and not to a look-alike address.
    if (state.issueFor && email === state.issueFor.email) body.userId = state.issueFor.id;
    else if (email) body.email = email;
    if ($("cNote").value.trim()) body.note = $("cNote").value.trim();
    if ($("cDevices").value) body.maxDevices = Number($("cDevices").value);
    if ($("cDaily").value) body.dailyLimit = Number($("cDaily").value);
    if (mode === "days") body.days = Number($("cDays").value);
    if (mode === "date") {
      if (!$("cDate").value) return void ($("createError").textContent = "Pick an end date.");
      body.expiresAt = new Date(`${$("cDate").value}T23:59:59Z`).toISOString();
    }
    const button = event.submitter;
    button.disabled = true;
    try {
      const { licenses } = await api("/licenses", { method: "POST", body });
      const keys = licenses.map((l) => l.key);
      $("createdList").replaceChildren(
        ...keys.map((key) => h("li", null, h("span", { class: "key mono" }, key), h("button", { class: "btn sm", type: "button", onclick: () => copy(key, "Key copied") }, "Copy"))),
      );
      $("copyAll").onclick = () => copy(keys.join("\n"), `${keys.length} key${keys.length === 1 ? "" : "s"} copied`);
      $("created").hidden = false;
      state.issueFor = null;
      state.offset = 0;
      await Promise.all([loadLicenses(), loadUsers(), loadStats()]);
    } catch (err) {
      $("createError").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  /* -------------------------------- detail -------------------------------- */

  const kv = (label, value) => h("div", null, h("span", null, label), value || "None");

  async function openDetail(id, newKey) {
    state.openId = id;
    const d = await api(`/licenses/${id}`);
    const l = d.license;
    $("dTitle").textContent = l.hint;
    const body = $("dBody");

    const act = (label, fn, cls = "") =>
      h("button", {
        class: `btn sm ${cls}`,
        type: "button",
        onclick: async (e) => {
          const button = e.currentTarget;
          button.disabled = true;
          try {
            await fn();
          } catch (err) {
            toast(err.message);
          }
          button.disabled = false;
        },
      }, label);
    const patch = async (changes, message) => {
      await api(`/licenses/${id}`, { method: "PATCH", body: changes });
      toast(message);
      await Promise.all([openDetail(id), loadLicenses()]);
    };
    // A license sold as "N days from first activation" that has not been
    // activated yet has no end date to move: lengthen its duration instead.
    const pending = !l.expiresAt && l.durationDays && !l.firstActivatedAt;
    const extend = (days) => {
      if (pending) return patch({ durationDays: l.durationDays + days }, `Now ${l.durationDays + days} days from first activation`);
      const base = l.expiresAt && new Date(l.expiresAt) > new Date() ? new Date(l.expiresAt) : new Date();
      return patch({ expiresAt: new Date(base.getTime() + days * 86400000).toISOString() }, `Extended by ${days} days`);
    };

    const sections = [
      newKey
        ? h("div", { class: "newkey" }, h("strong", null, "New key: "), h("span", { class: "mono key" }, newKey), " ",
            h("button", { class: "btn sm", type: "button", onclick: () => copy(newKey, "Key copied") }, "Copy"),
            h("div", { class: "muted small" }, "The old key no longer works. Devices that were already activated stay signed in."))
        : null,
      d.networks24h >= 6
        ? h("div", { class: "notice" }, `Used from ${d.networks24h} different networks in the last 24 hours. That often means the key is being shared.`)
        : null,
      h("div", { class: "kv" },
        kv("State", pill(l.state)),
        kv("Plan", `${l.planLabel} (${l.plan})`),
        kv("Daily limit", `${fmt(l.usedToday)} used of ${fmt(l.dailyLimit)}${l.overrides.dailyLimit ? " (custom)" : ""}`),
        kv("Devices", `${l.devicesUsed} of ${l.maxDevices}${l.overrides.maxDevices ? " (custom)" : ""}`),
        kv("Expires", l.expiresAt ? fmtDateTime(l.expiresAt) : l.durationDays ? `${l.durationDays} days after first activation` : "Never"),
        kv("First activated", fmtDateTime(l.firstActivatedAt) || "Not yet"),
        kv("Created", fmtDateTime(l.createdAt)),
        kv("Owner account", l.owner ? l.owner.email : l.email ? "Waiting for that email to sign in" : "None (key only)"),
        kv("Issued to email", l.email),
        kv("Note", l.note),
      ),
      h("div", { class: "row-actions" },
        l.state === "revoked"
          ? act("Restore", () => patch({ status: "active" }, "License restored"))
          : act("Revoke", () => confirm("Revoke this license? Its devices stop working immediately.") && patch({ status: "revoked" }, "License revoked"), "danger"),
        act("+30 days", () => extend(30)),
        act("+1 year", () => extend(365)),
        act("Never expires", () => patch({ expiresAt: null }, "Expiry removed")),
        act("Rotate key", async () => {
          if (!confirm("Issue a new key? The current key stops working for new activations.")) return;
          const r = await api(`/licenses/${id}/rotate`, { method: "POST" });
          await Promise.all([openDetail(id, r.key), loadLicenses()]);
        }),
        act("Release all devices", async () => {
          if (!confirm("Sign this license out of every device? The customer can activate again.")) return;
          const r = await api(`/licenses/${id}/reset-devices`, { method: "POST" });
          toast(`${r.released} device${r.released === 1 ? "" : "s"} released`);
          await Promise.all([openDetail(id), loadLicenses()]);
        }),
        l.owner
          ? act("Remove owner", () =>
              confirm(`Detach this license from ${l.owner.email}? It stays on the browsers it is active on, but stops following that account.`) &&
              patch({ userId: null, email: null }, "Owner removed"))
          : null,
        act("Edit email / note", async () => {
          const email = prompt("Customer email (leave empty to clear):", l.email || "");
          if (email === null) return;
          const note = prompt("Note (leave empty to clear):", l.note || "");
          if (note === null) return;
          await patch({ email: email.trim() || null, note: note.trim() || null }, "Saved");
        }),
      ),
      h("div", null,
        h("h3", null, "Devices"),
        h("div", { class: "table-wrap" },
          h("table", null,
            h("thead", null, h("tr", null, h("th", null, "Device"), h("th", null, "Activated"), h("th", null, "Last seen"), h("th", null, "Version"), h("th", { class: "num" }, "Generations"), h("th", null, ""))),
            h("tbody", null,
              d.devices.length
                ? d.devices.map((dev) =>
                    h("tr", null,
                      h("td", { class: "mono" }, dev.id.slice(0, 8)),
                      h("td", null, fmtDateTime(dev.activatedAt)),
                      h("td", null, fmtDateTime(dev.lastSeenAt)),
                      h("td", null, dev.clientVersion || ""),
                      h("td", { class: "num" }, fmt(dev.totalGenerations)),
                      h("td", null, act(dev.blocked ? "Unblock" : "Block", async () => {
                        await api(`/devices/${dev.id}/block`, { method: "POST", body: { blocked: !dev.blocked } });
                        toast(dev.blocked ? "Device unblocked" : "Device blocked");
                        await openDetail(id);
                      }, dev.blocked ? "" : "danger")),
                    ),
                  )
                : h("tr", null, h("td", { class: "empty", colspan: "6" }, "Not activated on any device.")),
            ),
          ),
        ),
      ),
      h("div", null,
        h("h3", null, "Usage, last 30 days"),
        h("div", { class: "table-wrap" },
          h("table", null,
            h("thead", null, h("tr", null, h("th", null, "Day (UTC)"), h("th", { class: "num" }, "Generations"), h("th", { class: "num" }, "Tokens"))),
            h("tbody", null,
              d.usage.length
                ? d.usage.map((u) => h("tr", null, h("td", null, u.day), h("td", { class: "num" }, fmt(u.count)), h("td", { class: "num" }, fmt(u.tokensIn + u.tokensOut))))
                : h("tr", null, h("td", { class: "empty", colspan: "3" }, "No usage yet.")),
            ),
          ),
        ),
      ),
      h("div", null,
        h("h3", null, "History"),
        h("div", { class: "table-wrap" },
          h("table", null,
            h("thead", null, h("tr", null, h("th", null, "When"), h("th", null, "Event"), h("th", null, "Device"), h("th", null, "Detail"))),
            h("tbody", null, d.events.map((e) => h("tr", null, h("td", null, fmtDateTime(e.ts)), h("td", null, e.type), h("td", { class: "mono" }, e.deviceId ? e.deviceId.slice(0, 8) : ""), h("td", { class: "wrap" }, e.detail || "")))),
          ),
        ),
      ),
    ];
    // replaceChildren would print a null argument as the text "null".
    body.replaceChildren(...sections.filter(Boolean));
    if (!$("detail").open) $("detail").showModal();
  }

  /* -------------------------------- wiring -------------------------------- */

  $("signInForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.token = $("token").value.trim();
    sessionStorage.setItem("xaicg_admin", state.token);
    $("signInError").textContent = "";
    start();
  });
  $("signOut").addEventListener("click", () => signOut(""));
  $("refresh").addEventListener("click", () => Promise.all([loadStats(), loadUsers(), loadLicenses()]).then(() => toast("Refreshed"), (err) => toast(err.message)));
  $("userFilter").addEventListener("change", () => {
    state.userOffset = 0;
    loadUsers().catch((err) => toast(err.message));
  });
  let userSearchTimer;
  $("userSearch").addEventListener("input", () => {
    clearTimeout(userSearchTimer);
    userSearchTimer = setTimeout(() => {
      state.userOffset = 0;
      loadUsers().catch((err) => toast(err.message));
    }, 250);
  });
  $("userPrev").addEventListener("click", () => {
    state.userOffset = Math.max(0, state.userOffset - PAGE);
    loadUsers().catch((err) => toast(err.message));
  });
  $("userNext").addEventListener("click", () => {
    state.userOffset += PAGE;
    loadUsers().catch((err) => toast(err.message));
  });
  $("cValidity").addEventListener("change", syncValidity);
  $("createForm").addEventListener("submit", createLicenses);
  $("dClose").addEventListener("click", () => $("detail").close());
  $("statusFilter").addEventListener("change", () => {
    state.offset = 0;
    loadLicenses().catch((err) => toast(err.message));
  });
  let searchTimer;
  $("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.offset = 0;
      loadLicenses().catch((err) => toast(err.message));
    }, 250);
  });
  $("prevPage").addEventListener("click", () => {
    state.offset = Math.max(0, state.offset - PAGE);
    loadLicenses().catch((err) => toast(err.message));
  });
  $("nextPage").addEventListener("click", () => {
    state.offset += PAGE;
    loadLicenses().catch((err) => toast(err.message));
  });

  syncValidity();
  if (state.token) start();
  else showSignedIn(false);
})();
