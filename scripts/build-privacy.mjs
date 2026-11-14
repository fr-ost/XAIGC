#!/usr/bin/env node
// Turns PRIVACY-POLICY.md into website/privacy.html.
//
//   node scripts/build-privacy.mjs
//
// The policy is written once, in PRIVACY-POLICY.md. Run this after editing it
// so the website shows the same text. It understands the small subset of
// Markdown the policy uses: headings, paragraphs, bullet lists, tables, bold,
// inline code and web addresses.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "PRIVACY-POLICY.md"), "utf8");

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Inline formatting. Code spans are set aside first so nothing inside them is
// touched, then bold and bare links are applied to the rest.
function inline(text) {
  const codes = [];
  let s = escape(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/https:\/\/[^\s<)]+[^\s<).,;:]/g, (url) => `<a href="${url}" rel="noopener">${url.replace(/^https:\/\//, "")}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const lines = source.split("\n");
const out = [];
let title = "Privacy Policy";
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  if (!line.trim() || /^---+$/.test(line.trim())) {
    i++;
  } else if (line.startsWith("# ")) {
    title = line.slice(2).trim();
    i++;
  } else if (/^#{2,3} /.test(line)) {
    const level = line.startsWith("### ") ? 3 : 2;
    out.push(`<h${level}>${inline(line.replace(/^#+ /, ""))}</h${level}>`);
    i++;
  } else if (line.startsWith("|")) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith("|")) {
      rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      i++;
    }
    const [head, , ...body] = rows; // rows[1] is the |---|---| separator
    out.push(
      `<div class="table-scroll"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
        body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
        "</tbody></table></div>",
    );
  } else if (/^- /.test(line)) {
    const items = [];
    while (i < lines.length && /^- /.test(lines[i])) items.push(`<li>${inline(lines[i].slice(2))}</li>`), i++;
    out.push(`<ul>${items.join("")}</ul>`);
  } else {
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||- |---)/.test(lines[i])) para.push(lines[i].trim()), i++;
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
}

const [heading, ...rest] = title.split(":");
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(heading.trim())} | XAIGC</title>
  <meta name="description" content="What XAIGC processes, what it keeps and why, in plain language.">
  <meta name="theme-color" content="#0a0f1f">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/icon-32.png">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <div class="page-head">
    <header class="nav wrap">
      <a class="logo" href="/" aria-label="XAIGC home"><img src="/assets/icon-128.png" width="36" height="36" alt=""><span>XAIGC</span></a>
      <nav aria-label="Main">
        <a href="/#features">Features</a>
        <a href="/#how">How it works</a>
        <a href="/#pricing">Pricing</a>
        <a href="/#faq">FAQ</a>
      </nav>
      <a class="btn small light" data-link="store" href="/#pricing">Add to Chrome</a>
    </header>
    <div class="wrap narrow"><h1>${escape(heading.trim())}</h1></div>
  </div>
  <!-- Generated from PRIVACY-POLICY.md by scripts/build-privacy.mjs. Edit that file, not this one. -->
  <main id="main" class="wrap narrow prose">
    ${rest.length ? `<p><strong>${inline(rest.join(":").trim())}</strong></p>\n    ` : ""}${out.join("\n    ")}
  </main>
  <footer class="footer">
    <div class="wrap footer-row">
      <a class="logo" href="/"><img src="/assets/icon-128.png" width="28" height="28" alt=""><span>XAIGC</span></a>
      <nav aria-label="Footer">
        <a href="/privacy">Privacy</a>
        <a data-link="support" href="https://uniquelabs.org">Support</a>
        <a href="https://uniquelabs.org" rel="noopener">uniquelabs.org</a>
      </nav>
    </div>
    <div class="wrap">
      <p>A product of <a href="https://uniquelabs.org" rel="noopener">Unique Labs</a>. Developed by Shahriar Ahmed.</p>
      <p>© <span data-fill="year">2026</span> Unique Labs. XAIGC is not affiliated with or endorsed by X Corp. X and Twitter are trademarks of their owner.</p>
    </div>
  </footer>
  <script src="/config.js"></script>
  <script src="/site.js"></script>
</body>
</html>
`;
await writeFile(path.join(root, "website", "privacy.html"), html);
console.log(`website/privacy.html written (${out.length} blocks)`);
