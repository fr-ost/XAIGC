#!/usr/bin/env node
// Builds the website's legal pages from their Markdown sources:
//
//   PRIVACY-POLICY.md  ->  website/privacy.html
//   TERMS.md           ->  website/terms.html
//
//   node scripts/build-privacy.mjs
//
// Each document is written once, in Markdown. Run this after editing either
// so the website shows the same text. It understands the small subset of
// Markdown they use: headings, paragraphs, bullet lists, tables, bold,
// inline code and web addresses.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pages = [
  { source: "PRIVACY-POLICY.md", output: "privacy.html", fallbackTitle: "Privacy Policy", description: "What XAICG processes, what it keeps and why, in plain language." },
  { source: "TERMS.md", output: "terms.html", fallbackTitle: "Terms and Conditions", description: "The terms for using XAICG: plans, payment, acceptable use and responsibility for what you post." },
];

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

for (const page of pages) {
  const source = await readFile(path.join(root, page.source), "utf8");
  const lines = source.split("\n");
  const out = [];
  let title = page.fallbackTitle;
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
  <title>${escape(heading.trim())} | XAICG</title>
  <meta name="description" content="${escape(page.description)}">
  <meta name="theme-color" content="#0a0b0d">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/icon-32.png">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <div class="top">
    <header class="nav wrap">
      <a class="logo" href="/" aria-label="XAICG home"><img src="/assets/icon-128.png" width="32" height="32" alt=""><span>XAICG</span></a>
      <nav aria-label="Main">
        <a href="/#features">Features</a>
        <a href="/#how">How it works</a>
        <a href="/#pricing">Pricing</a>
        <a href="/#faq">FAQ</a>
      </nav>
      <a class="btn primary small" data-link="store" href="/#pricing">Add to Chrome</a>
      <button class="menu-btn" type="button" aria-label="Menu" aria-expanded="false"><span></span><span></span></button>
    </header>
  </div>
  <div class="page-head">
    <div class="wrap narrow"><h1>${escape(heading.trim())}</h1></div>
  </div>
  <!-- Generated from ${page.source} by scripts/build-privacy.mjs. Edit that file, not this one. -->
  <main id="main" class="wrap narrow prose">
    ${rest.length ? `<p><strong>${inline(rest.join(":").trim())}</strong></p>\n    ` : ""}${out.join("\n    ")}
  </main>
  <footer class="footer">
    <div class="wrap">
      <div class="footer-cols">
        <div class="footer-about">
          <a class="logo" href="/"><img src="/assets/icon-128.png" width="28" height="28" alt=""><span>XAICG</span></a>
          <p>X AI Comment/Reply Generator. A product of <a href="https://uniquelabs.org" rel="noopener">Unique Labs</a>, developed by Shahriar Ahmed.</p>
        </div>
        <nav aria-label="Product">
          <h3>Product</h3>
          <ul>
            <li><a href="/#features">Features</a></li>
            <li><a href="/#how">How it works</a></li>
            <li><a href="/#pricing">Pricing</a></li>
            <li><a href="/#faq">FAQ</a></li>
          </ul>
        </nav>
        <nav aria-label="Company">
          <h3>Company</h3>
          <ul>
            <li><a href="https://uniquelabs.org" rel="noopener">Unique Labs</a></li>
            <li><a data-link="support" href="https://uniquelabs.org">Support</a></li>
          </ul>
        </nav>
        <nav aria-label="Legal">
          <h3>Legal</h3>
          <ul>
            <li><a href="/privacy">Privacy policy</a></li>
            <li><a href="/terms">Terms and conditions</a></li>
          </ul>
        </nav>
      </div>
      <div class="legal">
        <p>© <span data-fill="year">2026</span> Unique Labs. All rights reserved.</p>
        <p>XAICG is an independent product. It is not affiliated with or endorsed by X Corp. X and Twitter are trademarks of their owner.</p>
      </div>
    </div>
  </footer>
  <script src="/config.js"></script>
  <script src="/site.js"></script>
  <script src="/motion.js"></script>
</body>
</html>
`;
  await writeFile(path.join(root, "website", page.output), html);
  console.log(`website/${page.output} written (${out.length} blocks)`);
}
