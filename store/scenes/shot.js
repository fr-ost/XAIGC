// Builds one 1280x800 store screenshot from the ?spec= parameter:
//
//   { badge, headline, sub, points: [..], chips: [..],
//     frames:   [{ name, src, width, height, chrome, x, y, scale, tilt, rotate, z }],
//     callouts: [{ text, icon, x, y, rotate, dark }] }
//
// In the headline, *stars* mark the words set in the accent colour. Each
// frame is a live iframe of the real UI, placed on the stage at x/y.
(() => {
  const spec = JSON.parse(new URLSearchParams(location.search).get("spec") || "{}");
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  document.getElementById("badge").textContent = spec.badge || "";
  const headline = document.getElementById("headline");
  for (const [i, part] of String(spec.headline || "").split("*").entries()) {
    headline.append(i % 2 ? el("em", "", part) : document.createTextNode(part));
  }
  document.getElementById("sub").textContent = spec.sub || "";
  const points = document.getElementById("points");
  for (const p of spec.points || []) points.append(el("li", "", p));
  const chips = document.getElementById("chips");
  for (const c of spec.chips || []) chips.append(el("span", c.startsWith("!") ? "on" : "", c.replace(/^!/, "")));

  const stage = document.getElementById("stage");
  for (const f of spec.frames || []) {
    const frame = el("div", `frame ${f.chrome || "window"}`);
    frame.style.left = `${f.x || 0}px`;
    frame.style.top = `${f.y || 0}px`;
    frame.style.zIndex = String(f.z || 1);
    frame.style.transform = `rotateY(${f.tilt ?? -9}deg) rotateX(${f.lift ?? 3}deg) rotate(${f.rotate || 0}deg) scale(${f.scale || 1})`;
    const iframe = document.createElement("iframe");
    iframe.name = f.name || "";
    iframe.src = f.src;
    iframe.width = f.width;
    iframe.height = f.height;
    iframe.setAttribute("scrolling", "no");
    frame.appendChild(iframe);
    stage.appendChild(frame);
  }
  for (const c of spec.callouts || []) {
    const callout = el("div", `callout${c.dark ? " dark" : ""}`);
    if (c.icon) callout.append(el("i", "", c.icon));
    callout.append(el("span", "", c.text));
    callout.style.left = `${c.x}px`;
    callout.style.top = `${c.y}px`;
    callout.style.transform = `rotate(${c.rotate || 0}deg)`;
    stage.appendChild(callout);
  }
})();
