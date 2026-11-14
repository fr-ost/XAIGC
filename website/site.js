// Fills in links, numbers and the pricing cards from config.js.
(() => {
  "use strict";
  const cfg = window.XAICG_SITE || {};
  const all = (selector) => [...document.querySelectorAll(selector)];
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // "Add to Chrome" buttons: a real link once the store address is known.
  for (const a of all('[data-link="store"]')) {
    if (cfg.chromeStoreUrl) {
      a.href = cfg.chromeStoreUrl;
      a.target = "_blank";
      a.rel = "noopener";
    } else {
      a.removeAttribute("href");
      a.setAttribute("aria-disabled", "true");
      a.classList.add("pending");
      // The header button is small, so it gets the short form.
      a.textContent = a.classList.contains("small") ? "Coming soon" : "Coming soon to Chrome";
    }
  }
  for (const a of all('[data-link="buy"]')) a.href = cfg.buyUrl || "#pricing";
  for (const a of all('[data-link="support"]')) a.href = cfg.supportUrl || cfg.buyUrl || "#";
  for (const node of all('[data-fill="trial"]')) node.textContent = String(cfg.trialGenerations ?? 20);
  for (const node of all('[data-fill="year"]')) node.textContent = String(new Date().getFullYear());

  const plans = document.getElementById("plans");
  if (plans) {
    const card = ({ name, icon, price, period, lines, cta, featured }) => {
      const box = el("article", `plan${featured ? " featured" : ""}`);
      const top = el("div", "plan-top");
      const emo = el("span", "plan-emo", icon || (featured ? "👑" : "⭐"));
      emo.setAttribute("aria-hidden", "true");
      top.append(emo, el("h3", "", name));
      box.append(top);
      if (featured) box.append(el("span", "plan-tag", "Most popular"));
      const cost = el("p", "plan-price");
      if (price) {
        cost.append(el("strong", /\d/.test(price) ? "num" : "", price));
        if (period) cost.append(el("span", "", ` ${period}`));
      } else {
        cost.append(el("span", "plan-quiet", "See current pricing"));
      }
      box.append(cost);
      const list = el("ul");
      for (const line of lines) list.append(el("li", "", line));
      box.append(list);
      box.append(cta);
      return box;
    };

    const trial = Number(cfg.trialGenerations ?? 20);
    const start = el("a", "btn", "Start free");
    start.dataset.link = "store";
    start.href = cfg.chromeStoreUrl || "#top";
    if (cfg.chromeStoreUrl) {
      start.target = "_blank";
      start.rel = "noopener";
    }
    const cards = [
      card({
        name: "Free trial",
        icon: "🎟️",
        price: "Free",
        period: "",
        lines: [`${trial} generations to try everything`, "Every tone and every writing mode", "No card and no API key"],
        cta: start,
      }),
    ];
    for (const p of cfg.plans || []) {
      const buy = el("a", `btn${p.featured ? " primary" : ""}`, `Get ${p.name}`);
      buy.href = cfg.buyUrl || "#";
      buy.target = "_blank";
      buy.rel = "noopener";
      cards.push(
        card({
          name: p.name,
          icon: p.icon,
          price: p.price,
          period: p.period,
          featured: p.featured,
          lines: [`${p.perDay} generations a day`, `${p.devices} browser${p.devices === 1 ? "" : "s"} at a time`, "Your license follows your Google account"],
          cta: buy,
        }),
      );
    }
    plans.replaceChildren(...cards);
  }
})();
