// Keeps the page's outgoing links in step with config.js.
//
// The pages are built with these links already in place (see
// scripts/build-site.mjs), so nothing here is needed for the page to work.
// It means a change to an address in config.js shows up at once, before
// anyone rebuilds the pages.
(() => {
  "use strict";
  const cfg = window.XAICG_SITE || {};
  const all = (selector) => [...document.querySelectorAll(selector)];
  const outside = (a, href) => {
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
  };

  // "Add to Chrome" buttons: a real link once the store address is known.
  for (const a of all('[data-link="store"]')) {
    if (cfg.chromeStoreUrl) {
      outside(a, cfg.chromeStoreUrl);
    } else {
      a.removeAttribute("href");
      a.setAttribute("aria-disabled", "true");
      a.classList.add("pending");
      // The header button is small, so it gets the short form.
      a.textContent = a.classList.contains("small") ? "Coming soon" : "Coming soon to Chrome";
    }
  }
  // "Contact" buttons: an email address when one is set.
  for (const a of all('[data-link="contact"]')) {
    if (cfg.supportEmail) {
      a.href = `mailto:${cfg.supportEmail}`;
      a.removeAttribute("target");
      a.removeAttribute("rel");
      a.textContent = `Email ${cfg.supportEmail}`;
    } else if (cfg.contactUrl) {
      outside(a, cfg.contactUrl);
    }
  }
  for (const node of all('[data-fill="year"]')) node.textContent = String(new Date().getFullYear());
})();
