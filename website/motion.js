// Everything on the site that moves or responds: the sticky header and its
// mobile menu, the live demo in the hero, numbers that count up, and sections
// that ease in as they are scrolled to.
//
// The page is complete without this file. It only adds to what is there, and
// it stands down for anyone who has asked their device for less motion.
(() => {
  "use strict";
  const root = document.documentElement;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  root.classList.add("js");

  /* ------------------------------ header ------------------------------ */

  const top = $(".top");
  if (top) {
    const onScroll = () => top.classList.toggle("scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const toggle = $(".menu-btn", top);
    if (toggle) {
      const set = (open) => {
        top.classList.toggle("open", open);
        toggle.setAttribute("aria-expanded", String(open));
      };
      toggle.addEventListener("click", () => set(!top.classList.contains("open")));
      for (const link of $$("nav a", top)) link.addEventListener("click", () => set(false));
      document.addEventListener("keydown", (e) => e.key === "Escape" && set(false));
    }

    // Mark the menu link of the section being read.
    const links = $$('nav a[href^="#"]', top);
    const sections = links.map((a) => $(a.getAttribute("href"))).filter(Boolean);
    if (sections.length && "IntersectionObserver" in window) {
      const spy = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            for (const a of links) a.classList.toggle("current", a.getAttribute("href") === `#${entry.target.id}`);
          }
        },
        { rootMargin: "-45% 0px -50% 0px" },
      );
      sections.forEach((s) => spy.observe(s));
    }
  }

  /* --------------------------- ease in on scroll --------------------------- */

  const revealable = $$(".band-head, .card, .split-text, .frame, .plan, .faq details, .cta h2, .cta .actions, .stat, .prose > *");
  if (calm || !("IntersectionObserver" in window)) {
    revealable.forEach((node) => node.classList.add("in"));
  } else {
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("in");
          seen.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    for (const node of revealable) {
      // Cards in a row arrive one after another.
      const index = node.parentElement ? [...node.parentElement.children].indexOf(node) : 0;
      if (node.matches(".card, .plan, .stat")) node.style.transitionDelay = `${Math.min(index, 5) * 70}ms`;
      node.classList.add("reveal");
      seen.observe(node);
    }
  }

  /* ----------------------------- counting up ----------------------------- */

  const counters = $$("[data-count]");
  const runCounter = (node) => {
    const target = Number(node.dataset.count);
    if (calm || !target) return void (node.textContent = String(target));
    const started = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - started) / 900);
      node.textContent = String(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ("IntersectionObserver" in window) {
    const watch = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        runCounter(entry.target);
        watch.unobserve(entry.target);
      }
    });
    counters.forEach((c) => watch.observe(c));
  } else {
    counters.forEach(runCounter);
  }

  /* ------------------------------ live demo ------------------------------ */

  // Sample drafts, typed out the way the extension types into X's reply box.
  const demo = $("#demo");
  if (demo) {
    const SAMPLES = {
      auto: [
        "Cheaper is nice, but the bridge has to stay up on a busy day for the cut to mean anything.",
        "80% off is real money on small transfers. Curious what it does to your revenue.",
      ],
      witty: [
        "So the bridge finally costs less than the coffee I drink while waiting for it.",
        "Fees down 80%. My excuses for not moving funds: also down 80%.",
      ],
      skeptical: [
        "An 80% cut usually means volume was soft. What did fees look like last quarter?",
        "Withdrawals included is the part I'd check twice. Is there a cap on size?",
      ],
      supportive: [
        "Including withdrawals is the part people will notice. Good call making it for everyone.",
        "This helps small users the most. Nice to see the cut apply across the board.",
      ],
      blunt: [
        "Good. The old fees were the main reason I stopped bridging.",
        "Fees were too high. This fixes it. Now fix the wait times.",
      ],
    };
    const TONES = Object.keys(SAMPLES);
    const draft = $("#demoDraft");
    const count = $("#demoCount");
    const run = $("#demoRun");
    const again = $("#demoAgain");
    const toast = $("#demoToast");
    const left = $("#demoLeft");
    const bar = $("#demoBar");
    const chips = $$("[data-tone]", demo);
    const TRIAL = Number(left?.dataset.total || 20);

    let tone = "auto";
    let variant = 0;
    let remaining = TRIAL - 4;
    let job = 0; // bumping this cancels whatever is being typed
    let touched = false;
    let cycle = null;

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const showQuota = () => {
      if (left) left.textContent = String(remaining);
      if (bar) bar.style.width = `${((TRIAL - remaining) / TRIAL) * 100}%`;
    };
    const select = (name) => {
      tone = name;
      for (const chip of chips) chip.setAttribute("aria-pressed", String(chip.dataset.tone === name));
    };

    async function write({ spend }) {
      const mine = ++job;
      const text = SAMPLES[tone][variant % SAMPLES[tone].length];
      toast?.classList.remove("show");
      if (calm) {
        draft.textContent = text;
        count.textContent = `${text.length} / 280`;
      } else {
        demo.classList.add("busy");
        draft.textContent = "";
        count.textContent = "0 / 280";
        await wait(520);
        if (mine !== job) return;
        demo.classList.remove("busy");
        demo.classList.add("typing");
        for (let i = 1; i <= text.length; i++) {
          if (mine !== job) return;
          draft.textContent = text.slice(0, i);
          count.textContent = `${i} / 280`;
          await wait(text[i - 1] === " " ? 26 : 16);
        }
        demo.classList.remove("typing");
      }
      if (spend) {
        remaining = remaining > 6 ? remaining - 1 : TRIAL - 1;
        showQuota();
      }
      toast?.classList.add("show");
    }

    const byHand = (fn) => () => {
      touched = true;
      clearInterval(cycle);
      fn();
    };
    run.addEventListener("click", byHand(() => { variant = 0; write({ spend: true }); }));
    // As in the extension, another draft from the same request costs nothing.
    again.addEventListener("click", byHand(() => { variant++; write({ spend: false }); }));
    for (const chip of chips) {
      chip.addEventListener("click", byHand(() => { select(chip.dataset.tone); variant = 0; write({ spend: true }); }));
    }

    showQuota();
    const start = () => {
      write({ spend: false });
      if (calm) return;
      // Until someone takes over, walk through the tones.
      cycle = setInterval(() => {
        if (touched || document.hidden) return;
        select(TONES[(TONES.indexOf(tone) + 1) % TONES.length]);
        variant = 0;
        write({ spend: true });
      }, 6500);
    };
    if ("IntersectionObserver" in window) {
      const once = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        once.disconnect();
        start();
      }, { threshold: 0.3 });
      once.observe(demo);
    } else {
      start();
    }
  }
})();
