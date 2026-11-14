// Builds one captioned 1280x800 store screenshot from the ?spec= parameter:
// { headline, sub, frames: [{ name, src, width, height, chrome }] }.
// Each frame is a live iframe of the real UI.
(() => {
  const spec = JSON.parse(new URLSearchParams(location.search).get("spec") || "{}");
  document.getElementById("headline").textContent = spec.headline || "";
  document.getElementById("sub").textContent = spec.sub || "";
  const stage = document.getElementById("stage");
  for (const f of spec.frames || []) {
    const frame = document.createElement("div");
    frame.className = `frame ${f.chrome || "window"}`;
    if ((f.chrome || "window") === "window") {
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.innerHTML = "<i></i><i></i><i></i>";
      frame.appendChild(bar);
    }
    const iframe = document.createElement("iframe");
    iframe.name = f.name || "";
    iframe.src = f.src;
    iframe.width = f.width;
    iframe.height = f.height;
    iframe.setAttribute("scrolling", "no");
    frame.appendChild(iframe);
    stage.appendChild(frame);
  }
})();
