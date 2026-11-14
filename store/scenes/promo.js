// ?size=small | marquee | og picks the layout (see promo.css).
document.documentElement.dataset.size = new URLSearchParams(location.search).get("size") || "marquee";
