// XAICG content script for x.com.
//
// Adds reply tools to every post, extracts the post's text, asks the service
// worker for drafts and types the chosen draft into X's reply box. Nothing is
// ever posted automatically: the user always reviews and presses Reply.
//
// A product of Unique Labs (https://uniquelabs.org). Developed by Shahriar Ahmed.

(() => {
  "use strict";
  if (window.__xaicgLoaded) return;
  window.__xaicgLoaded = true;

  const TONES = [
    ["auto", "Auto"],
    ["casual", "Casual"],
    ["witty", "Witty"],
    ["supportive", "Supportive"],
    ["skeptical", "Skeptical"],
    ["analytical", "Analytical"],
    ["blunt", "Blunt"],
    ["technical", "Technical"],
    ["professional", "Professional"],
  ];
  const DEFAULT_SETTINGS = { outputMode: "insert", showQuestionButton: true, sfx: true };

  const ICON_SPARK = `<svg class="xaicg-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M3.4 12.6l2.1-2.1M10.5 5.5l2.1-2.1"/></svg>`;
  const ICON_QUESTION = `<svg class="xaicg-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 5.5a2.5 2.5 0 1 1 3.6 2.25c-.7.34-1.1.9-1.1 1.6V10"/><circle cx="8" cy="13" r=".7" fill="currentColor" stroke="none"/></svg>`;
  const ICON_REGEN = `<svg class="xaicg-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 8a6 6 0 1 1-1.76-4.24"/><path d="M14 2.5V6h-3.5"/></svg>`;
  const ICON_CHEVRON = `<svg class="xaicg-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>`;

  /* ----------------------------- extension link ---------------------------- */

  function runtimeAlive() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  function fail(code, message, extra = {}) {
    const err = new Error(message);
    err.code = code;
    Object.assign(err, extra);
    return err;
  }

  async function send(type, data = {}) {
    const stale = "XAICG was updated. Refresh this page to keep using it.";
    if (!runtimeAlive()) throw fail("context", stale);
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type, ...data });
    } catch {
      throw fail("context", stale);
    }
    if (!res) throw fail("context", stale);
    if (!res.ok) {
      const { code, message, ...extra } = res.error || {};
      throw fail(code || "unexpected", message || "Something went wrong.", extra);
    }
    return res.data;
  }

  // Sounds and small flourishes. Both are extras: a missing sound module or
  // an old browser must never stop a draft from being written.
  const sfx = (name) => {
    try {
      globalThis.XAICG_SFX?.play(name);
    } catch {
      /* no sound */
    }
  };
  const applySound = () => {
    if (globalThis.XAICG_SFX) globalThis.XAICG_SFX.enabled = settings.sfx !== false;
  };
  const calm = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // Add a class for one animation, then take it off again.
  function flash(el, className, ms = 700) {
    if (!el || calm()) return;
    el.classList.remove(className);
    void el.offsetWidth; // restart the animation if it is already running
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), ms);
  }
  // A ring that spreads from the reply box when a draft lands in it. It uses
  // the Web Animations API, so nothing is added to X's own element.
  function glow(box) {
    if (calm() || !box?.animate) return;
    try {
      box.animate(
        [{ boxShadow: "0 0 0 0 rgba(252, 213, 53, 0.6)" }, { boxShadow: "0 0 0 10px rgba(252, 213, 53, 0)" }],
        { duration: 750, easing: "ease-out" },
      );
    } catch {
      /* not supported */
    }
  }
  // A handful of coloured dots fly out of the button when a draft lands.
  const DOT_COLORS = ["#fcd535", "#ffffff", "#fcd535", "#f0b90b", "#fcd535", "#ffffff"];
  function burst(el) {
    if (!el || calm() || !document.body.animate) return;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    DOT_COLORS.forEach((color, i) => {
      const dot = document.createElement("span");
      dot.className = "xaicg-dot";
      dot.style.left = `${x - 3}px`;
      dot.style.top = `${y - 3}px`;
      dot.style.background = color;
      document.body.appendChild(dot);
      const angle = (i / DOT_COLORS.length) * Math.PI * 2 + 0.4;
      const reach = 30 + (i % 3) * 9;
      dot
        .animate(
          [
            { transform: "translate(0, 0) scale(1)", opacity: 1 },
            { transform: `translate(${Math.cos(angle) * reach}px, ${Math.sin(angle) * reach}px) scale(0.3)`, opacity: 0 },
          ],
          { duration: 480, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
        )
        .finished.catch(() => {})
        .then(() => dot.remove());
    });
  }
  // The reply box XAICG last filled, so the "sent" sound plays only for a
  // reply it helped write.
  let draftedBox = null;

  // Settings and the cached account are read straight from extension storage
  // and kept fresh through change events.
  let settings = { ...DEFAULT_SETTINGS };
  let account = null;

  async function loadState() {
    if (!runtimeAlive()) return;
    try {
      const stored = await chrome.storage.local.get(["settings", "account"]);
      settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
      account = stored.account || null;
      applySound();
    } catch {
      /* extension context gone */
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.settings) {
        settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
        applySound();
        document.querySelectorAll(".xaicg-btn.q").forEach((b) => (b.hidden = !settings.showQuestionButton));
      }
      if (changes.account) {
        account = changes.account.newValue || null;
        document.querySelectorAll(".xaicg-btn").forEach(applyGauge);
      }
    });
  } catch {
    /* extension context gone */
  }

  /* --------------------------------- theme --------------------------------- */

  // X has its own light / dim / lights-out themes that ignore the OS setting,
  // so follow the page background instead of prefers-color-scheme.
  function syncTheme() {
    const rgb = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
    if (!rgb) return;
    const [r, g, b] = rgb.map(Number);
    const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
    document.documentElement.dataset.xaicgTheme = dark ? "dark" : "light";
  }

  /* --------------------------------- toast --------------------------------- */

  function toast(message, { error = false, ms = 3200, action = null } = {}) {
    document.querySelector(".xaicg-toast")?.remove();
    const el = document.createElement("div");
    el.className = "xaicg-toast" + (error ? " error" : "");
    el.setAttribute("role", error ? "alert" : "status");
    const text = document.createElement("span");
    text.textContent = message;
    el.appendChild(text);
    if (action) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        el.remove();
        action.run();
      });
      el.appendChild(btn);
    }
    document.body.appendChild(el);
    setTimeout(() => el.remove(), action ? Math.max(ms, 8000) : ms);
  }

  function showError(err) {
    if (err?.code !== "context") sfx("error");
    const openPlans = () => send("xaicg:open-plans").catch(() => {});
    const openAccount = () => send("xaicg:open-options", { section: "account" }).catch(() => {});
    switch (err?.code) {
      case "sign_in_required":
        return toast(err.message || "Sign in with Google to get your free comments.", { error: true, action: { label: "Sign in", run: openAccount } });
      case "free_limit":
        return toast(err.message || "You've used today's free comments. They come back at 00:00 UTC.", { error: true, action: { label: "See plans", run: openPlans } });
      case "free_busy":
        return toast(err.message, { error: true, action: { label: "See plans", run: openPlans } });
      case "cooldown":
      case "busy":
      case "rate_limited":
        return toast(err.message || "Slow down a moment.", { error: true, ms: 2600 });
      default:
        return toast(err?.message || "Something went wrong.", { error: true, ms: 4200 });
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  /* --------------------------- reading the post ---------------------------- */

  const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

  // Text of an element including emoji, which X renders as <img alt="...">.
  function richText(el) {
    let out = "";
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue;
      else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === "IMG") out += node.getAttribute("alt") || "";
        else if (node.tagName === "BR") out += "\n";
        else node.childNodes.forEach(walk);
      }
    };
    walk(el);
    return out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  function extractPost(article) {
    let author = "";
    const userArea = article.querySelector('[data-testid="User-Name"]');
    if (userArea) {
      const handle = [...userArea.querySelectorAll("span")].map((s) => squash(s.textContent)).find((t) => /^@\w{1,15}$/.test(t));
      if (handle) author = handle.slice(1);
    }

    const texts = [...article.querySelectorAll('[data-testid="tweetText"]')].map(richText).filter(Boolean);
    const extra = [];
    const add = (label, value) => {
      const v = squash(value).slice(0, 500);
      if (v.length > 3 && !extra.some((e) => e.endsWith(v)) && extra.length < 6) extra.push(`${label}: ${v}`);
    };
    texts.slice(1).forEach((t) => add("Quoted post", t));
    article.querySelectorAll('[data-testid="tweetPhoto"] img[alt]').forEach((img) => {
      const alt = squash(img.getAttribute("alt"));
      if (alt && !/^(image|photo)$/i.test(alt)) add("Image description", alt);
    });
    article.querySelectorAll('[data-testid="card.wrapper"]').forEach((card) => add("Link card", card.innerText || card.textContent));

    // A post with no text of its own (image or card only) is described by
    // its attachments.
    let text = (texts[0] || "").slice(0, 3800);
    if (!text && extra.length) text = extra.shift();
    return { author, text, extra };
  }

  // The signed-in account's handle, read from X's own navigation. It is
  // hashed in the service worker before leaving the browser.
  function viewerHandle() {
    const href = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute("href") || "";
    const fromNav = href.match(/^\/([A-Za-z0-9_]{1,15})$/);
    if (fromNav) return fromNav[1];
    const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')?.textContent || "";
    const fromSwitcher = switcher.match(/@([A-Za-z0-9_]{1,15})/);
    return fromSwitcher ? fromSwitcher[1] : null;
  }

  /* --------------------------- finding the reply box ----------------------- */

  const TEXTBOX_SELECTOR = ['div[data-testid^="tweetTextarea_"][role="textbox"]', 'div[role="textbox"][contenteditable="true"]'].join(",");
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
  }

  function dialogTextbox() {
    return [...document.querySelectorAll('[role="dialog"]')].flatMap((d) => [...d.querySelectorAll(TEXTBOX_SELECTOR)]).find(isVisible) || null;
  }

  function focusedTextbox() {
    const active = document.activeElement;
    const box = active?.matches?.(TEXTBOX_SELECTOR) ? active : active?.closest?.(TEXTBOX_SELECTOR);
    return box && isVisible(box) ? box : null;
  }

  function findReplyButton(article) {
    return (
      article.querySelector('[data-testid="reply"]') ||
      [...article.querySelectorAll('button, div[role="button"]')].find((el) => /reply/i.test(el.getAttribute("aria-label") || ""))
    );
  }

  // The only acceptable box is one X itself opened for this post: an open
  // reply dialog, or, after pressing the post's own Reply button, the dialog
  // it opens (timeline) or the box it focuses (the main post on a status
  // page). There is deliberately no "closest text box" fallback. If replies
  // are restricted or X is slow and nothing opens, returning null makes the
  // caller copy the draft instead, rather than clearing and overwriting some
  // unrelated editor such as a half-written post in the home composer.
  async function findOrOpenReplyBox(article) {
    const open = dialogTextbox();
    if (open) return open;
    const replyButton = findReplyButton(article);
    if (!replyButton) return null;
    const before = focusedTextbox();
    replyButton.click();
    for (let i = 0; i < 20; i++) {
      await wait(150);
      const box = dialogTextbox() || focusedTextbox();
      if (box && box !== before) return box;
    }
    return null;
  }

  /* ---------------------------- typing into the box ------------------------ */

  const boxText = (box) => squash((box?.innerText || box?.textContent || "").replace(/ /g, " "));

  function fireInput(box, inputType) {
    let event;
    try {
      // data stays null on purpose: the editor re-reads the DOM, and passing
      // the text here makes some editor versions insert it a second time.
      event = new InputEvent("input", { bubbles: true, cancelable: false, composed: true, inputType, data: null });
    } catch {
      event = new Event("input", { bubbles: true, cancelable: false, composed: true });
    }
    box.dispatchEvent(event);
  }

  function dispatchPaste(box, text) {
    try {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      box.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, composed: true, clipboardData: data }));
      return true;
    } catch {
      return false;
    }
  }

  async function clearBox(box) {
    box.focus({ preventScroll: true });
    for (let i = 0; i < 30; i++) {
      const before = boxText(box);
      if (!before) return;
      try {
        document.execCommand("selectAll", false, null);
        document.execCommand("delete", false, null);
      } catch {
        /* keep going */
      }
      fireInput(box, "deleteContentBackward");
      await wait(8);
      if (boxText(box) === before) break; // nothing moved; more passes will not help
    }
  }

  // Replace the box's contents with `text`, in three verified phases:
  //   1. clear (select all + delete), 2. insert through the editor's paste
  //   path, falling back to insertText, 3. read back and retry once.
  // X's editor keeps its own document model, so writing to the DOM directly
  // desynchronizes it; going through paste keeps the model and DOM in step.
  async function performInsert(box, text, attempt = 1) {
    box.focus({ preventScroll: true });
    await clearBox(box);
    await wait(0);

    const before = boxText(box);
    dispatchPaste(box, text);
    await wait(0);
    let after = boxText(box);
    if (after === before) {
      try {
        document.execCommand("insertText", false, text);
      } catch {
        /* verified below */
      }
      await wait(0);
      after = boxText(box);
    }

    const expected = squash(text);
    if (after === expected) return true;
    if (attempt < 2) {
      await wait(20);
      return performInsert(box, text, attempt + 1);
    }
    return after.includes(expected);
  }

  async function insertDraft(box, text) {
    if (!box || box.getAttribute("contenteditable") !== "true") return false;
    if (box.dataset.xaicgInserting === "1") return false; // rapid double click
    box.dataset.xaicgInserting = "1";
    try {
      return await performInsert(box, String(text || "").trim());
    } catch (err) {
      console.error("[XAICG] insert failed", err);
      return false;
    } finally {
      setTimeout(() => {
        box.dataset.xaicgInserting = "0";
      }, 80);
    }
  }

  /* ------------------------------- generation ------------------------------ */

  // Per-post draft state, so "try another" can step through the variants the
  // server already returned before spending another generation.
  const drafts = new WeakMap();

  function quotaNote(acct) {
    if (!acct || acct.licensed) return "";
    const left = acct.quota?.remaining ?? 0;
    return ` ${left} free ${left === 1 ? "comment" : "comments"} left today.`;
  }

  async function nextDraft(article, kind, tone) {
    const state = drafts.get(article);
    if (state && state.kind === kind && state.tone === tone && state.index + 1 < state.variants.length) {
      state.shown.push(state.variants[state.index]);
      state.index++;
      return { text: state.variants[state.index], note: "" };
    }

    const post = extractPost(article);
    if (!post.text) throw fail("no_text", "Couldn't find any text in this post to reply to.");
    const rejected = state && state.kind === kind ? [...state.shown, state.variants[state.index]].filter(Boolean).slice(-4) : [];
    const data = await send("xaicg:generate", {
      payload: { kind, tone: tone === "default" ? undefined : tone, post, rejected, handle: viewerHandle() },
    });
    const variants = data.variants || [];
    if (!variants.length) throw fail("empty", "Nothing came back. Try again.");
    drafts.set(article, { kind, tone, variants, index: 0, shown: rejected });
    return { text: variants[0], note: quotaNote(data.account) };
  }

  async function deliver(article, kind, text, note, knownBox = null) {
    const remember = () => send("xaicg:remember", { text }).catch(() => {});

    if (kind === "quote") {
      await copyText(text);
      remember();
      sfx("done");
      return toast(`Quote text copied. Choose Repost, then Quote, and paste.${note}`, { ms: 5200 });
    }
    if (settings.outputMode === "clipboard") {
      await copyText(text);
      remember();
      sfx("done");
      return toast(`Copied. Paste it where you want.${note}`);
    }

    const box = knownBox && document.contains(knownBox) ? knownBox : await findOrOpenReplyBox(article);
    if (!box || !(await insertDraft(box, text))) {
      await copyText(text);
      remember();
      sfx("error");
      return toast("Couldn't type into the reply box, so the draft was copied instead.", { error: true, ms: 4600 });
    }
    remember();
    draftedBox = box;
    sfx("done");
    glow(box);
    attachRegenerate(box, article, kind);
    toast(`Draft inserted. Review it before posting.${note}`);
  }

  async function run(article, btn, kind, tone = "default") {
    if (btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";
    const label = btn.querySelector(".xaicg-label");
    const original = label?.textContent;
    if (label) label.textContent = "Writing…";
    sfx("start");
    try {
      const { text, note } = await nextDraft(article, kind, tone);
      await deliver(article, kind, text, note);
      flash(btn, "xaicg-ok", 620);
      burst(btn);
    } catch (err) {
      if (err?.code !== "context") console.warn("[XAICG]", err?.code, err?.message);
      showError(err);
      flash(btn, "xaicg-shake", 500);
    } finally {
      delete btn.dataset.busy;
      if (label) label.textContent = original;
    }
  }

  /* ------------------------- "try another" floater ------------------------- */

  function attachRegenerate(box, article, kind) {
    document.querySelectorAll(".xaicg-regen").forEach((el) => el.remove());
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "xaicg-regen";
    btn.title = "Try another draft";
    btn.setAttribute("aria-label", "Try another draft");
    btn.innerHTML = ICON_REGEN;

    const place = () => {
      const r = box.getBoundingClientRect();
      btn.style.top = `${window.scrollY + r.top - 4}px`;
      btn.style.left = `${window.scrollX + r.right - 14}px`;
    };
    place();
    document.body.appendChild(btn);

    let frame = 0;
    const onMove = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    const onInput = (e) => {
      // A trusted input outside of our own insert means the user has started
      // editing and no longer wants the overlay. Our inserts also raise
      // trusted input events (execCommand does), so they are told apart by
      // the in-progress flag, not by isTrusted alone.
      if (e.isTrusted && box.dataset.xaicgInserting !== "1") destroy();
    };
    const observer = new MutationObserver(() => {
      if (!document.contains(box) || !isVisible(box)) destroy();
    });
    function destroy() {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      box.removeEventListener("input", onInput);
      observer.disconnect();
      btn.remove();
    }
    window.addEventListener("scroll", onMove, { passive: true, capture: true });
    window.addEventListener("resize", onMove, { passive: true });
    box.addEventListener("input", onInput);
    observer.observe(document.body, { childList: true, subtree: true });

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.isTrusted || btn.dataset.busy === "1") return;
      btn.dataset.busy = "1";
      sfx("start");
      try {
        const state = drafts.get(article);
        const { text, note } = await nextDraft(article, kind, state?.tone ?? "default");
        if (await insertDraft(box, text)) {
          draftedBox = box;
          sfx("done");
          glow(box);
          send("xaicg:remember", { text }).catch(() => {});
          if (note) toast(`New draft inserted.${note}`);
        } else {
          await copyText(text);
          toast("Couldn't replace the text, so the new draft was copied instead.", { error: true });
        }
      } catch (err) {
        showError(err);
      } finally {
        delete btn.dataset.busy;
      }
    });
  }

  /* ------------------------------- tone menu ------------------------------- */

  let closeMenu = () => {};

  function openMenu(anchor, article, replyBtn) {
    closeMenu();
    document.querySelector(".xaicg-toast")?.remove(); // never let a toast cover the menu
    const menu = document.createElement("div");
    menu.className = "xaicg-menu";
    menu.setAttribute("role", "menu");

    const label = document.createElement("div");
    label.className = "xaicg-menu-label";
    label.textContent = "Reply in a tone";
    menu.appendChild(label);

    const item = (text, onPick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = text;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!e.isTrusted) return;
        closeMenu();
        onPick();
      });
      menu.appendChild(b);
      return b;
    };
    for (const [id, name] of TONES) item(name, () => run(article, replyBtn, "reply", id));
    menu.appendChild(document.createElement("hr"));
    item("Copy a quote-post line", () => run(article, replyBtn, "quote"));
    item("XAICG settings", () => send("xaicg:open-options").catch(showError));

    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, r.right - width));
    const below = r.bottom + 6 + height <= window.innerHeight;
    menu.style.left = `${window.scrollX + left}px`;
    menu.style.top = `${window.scrollY + (below ? r.bottom + 6 : Math.max(8, r.top - height - 6))}px`;
    menu.querySelector("button")?.focus({ preventScroll: true });

    const onDown = (e) => {
      if (!menu.contains(e.target) && e.target !== anchor) closeMenu();
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        closeMenu();
        anchor.focus({ preventScroll: true });
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...menu.querySelectorAll("button")];
        const i = items.indexOf(document.activeElement);
        items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    anchor.setAttribute("aria-expanded", "true");
    closeMenu = () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      anchor.setAttribute("aria-expanded", "false");
      menu.remove();
      closeMenu = () => {};
    };
  }

  /* ------------------------------ "sent" sound ------------------------------ */

  // XAICG never posts. When the person presses X's own Reply button (or
  // Ctrl/Cmd+Enter) on a reply XAICG drafted, that is the moment for the
  // "sent" sound. This only listens; it changes nothing about the click.
  const SUBMIT = '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]';
  function sentFrom(scope) {
    const box = draftedBox;
    if (!box || !document.contains(box) || !box.textContent.trim()) return;
    const dialog = box.closest('[role="dialog"]');
    if (dialog ? !dialog.contains(scope) : Boolean(scope.closest?.('[role="dialog"]'))) return;
    draftedBox = null;
    sfx("send");
  }
  document.addEventListener(
    "click",
    (e) => {
      const button = e.isTrusted && e.target.closest?.(SUBMIT);
      if (button && button.getAttribute("aria-disabled") !== "true") sentFrom(button);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.isTrusted && e.key === "Enter" && (e.ctrlKey || e.metaKey) && draftedBox?.contains(e.target)) sentFrom(e.target);
    },
    true,
  );

  /* ------------------------------ post buttons ----------------------------- */

  // Tint the buttons as the allowance runs down: amber from 70% used, red
  // from 90%, with the exact numbers in the tooltip.
  function applyGauge(btn) {
    btn.classList.remove("gauge-warn", "gauge-bad");
    const q = account?.quota;
    if (!q || !q.limit) return;
    const pct = (q.used / q.limit) * 100;
    if (pct >= 90) btn.classList.add("gauge-bad");
    else if (pct >= 70) btn.classList.add("gauge-warn");
    const scope = q.scope === "free" ? "free comments left today" : "generations left today";
    btn.dataset.quota = `${q.remaining} of ${q.limit} ${scope}`;
    btn.title = `${btn.dataset.baseTitle} · ${btn.dataset.quota}`;
  }

  function makeButton(className, html, title) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `xaicg-btn ${className}`;
    btn.innerHTML = html;
    btn.dataset.baseTitle = title;
    btn.title = title;
    return btn;
  }

  function createButtons(article) {
    const wrap = document.createElement("div");
    wrap.className = "xaicg-wrap";

    const reply = makeButton("ai", `${ICON_SPARK}<span class="xaicg-label">AI Reply</span>`, "Draft a reply in your voice");
    const question = makeButton("q", `${ICON_QUESTION}<span class="xaicg-label">Question</span>`, "Draft a short, specific question");
    const more = makeButton("more icon-only", ICON_CHEVRON, "Tones and more");
    more.setAttribute("aria-label", "XAICG: tones and more");
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    question.hidden = !settings.showQuestionButton;

    // isTrusted: only a real click from the person at the keyboard may spend
    // a generation. A script on the page calling .click() is ignored.
    const guard = (fn) => (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.isTrusted) fn();
    };
    reply.addEventListener("click", guard(() => run(article, reply, "reply")));
    question.addEventListener("click", guard(() => run(article, question, "question")));
    more.addEventListener("click", guard(() => (more.getAttribute("aria-expanded") === "true" ? closeMenu() : openMenu(more, article, reply))));

    wrap.append(reply, question, more);
    [reply, question].forEach(applyGauge);
    return wrap;
  }

  function findActionBar(article) {
    const reply = findReplyButton(article);
    const group = reply?.closest('[role="group"]');
    if (group) return group;
    const groups = [...article.querySelectorAll('[role="group"]')].filter(isVisible);
    return groups[groups.length - 1] || null;
  }

  function scan() {
    if (!runtimeAlive()) return; // the extension was reloaded; this script is orphaned
    syncTheme();
    for (const article of document.querySelectorAll('article[data-testid="tweet"], article[role="article"]')) {
      // Check for the buttons themselves rather than a marker on the post:
      // when X re-renders a post's action bar, the buttons come back.
      if (article.querySelector(".xaicg-wrap")) continue;
      const bar = findActionBar(article);
      if (bar) bar.appendChild(createButtons(article));
    }
  }

  let scanTimer = null;
  const scheduleScan = () => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  };

  loadState().then(() => {
    scan();
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
    setInterval(scan, 3000);
  });
})();
