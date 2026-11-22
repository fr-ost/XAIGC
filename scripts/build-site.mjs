#!/usr/bin/env node
// Builds every page of the website from its sources.
//
//   node scripts/build-site.mjs
//
// Sources (edit these):
//   website/config.js                    addresses, numbers and prices
//   content/home.html                    the home page's sections
//   content/about.md, contact.md, faq.md the about, contact and FAQ pages
//   content/blog/*.md                    the blog, one article per file
//   PRIVACY-POLICY.md, TERMS.md, SUPPORT.md
//
// Output (generated, do not edit by hand):
//   website/index.html and the other pages, website/blog/
//   website/sitemap.xml, website/robots.txt, website/feed.xml
//
// Every page gets the same header and footer, and what a search engine or a
// link preview looks for: one title and description of its own, a canonical
// address, Open Graph tags and structured data (schema.org). The build ends
// by following every link between the pages, and fails if one leads nowhere.
//
// Markdown here is a small subset: headings, paragraphs, bullet and numbered
// lists, tables, quotes, bold, italic, inline code, [links](/like/this) and
// bare web addresses. Files under content/ may start with a "---" block of
// `key: value` lines.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "website");
const content = path.join(root, "content");

/* --------------------------------- settings -------------------------------- */

const sandbox = { window: {} };
vm.runInNewContext(await readFile(path.join(site, "config.js"), "utf8"), sandbox);
const cfg = sandbox.window.XAICG_SITE;
if (!cfg || !/^https:\/\/[^/]+$/.test(cfg.siteUrl || "")) {
  console.error('website/config.js needs siteUrl, for example "https://xaicg.example" (https, no slash at the end).');
  process.exit(1);
}
const ORIGIN = cfg.siteUrl;
const VERSION = JSON.parse(await readFile(path.join(root, "extension", "manifest.json"), "utf8")).version;
const NAME = "XAICG";
const FULL_NAME = "X AI Comment/Reply Generator for Twitter";
const MAKER = "Unique Labs";
const MAKER_URL = "https://uniquelabs.org";
const SHARE_IMAGE = "/assets/og.png"; // 1200 x 630
// Every page that offers the extension says the same about it.
const PITCH = "Free forever, with no limit and no sign-up.";

/* ---------------------------------- helpers --------------------------------- */

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const url = (p) => ORIGIN + p;
const slugify = (s) => s.toLowerCase().replace(/&[a-z]+;/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// The words of a piece of HTML, for structured data and feeds.
const plain = (html) =>
  html
    .replace(/<\/(p|li|h\d|tr)>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const longDate = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const jsonld = (graph) =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c")}</script>`;

// Every PNG on a page states its real size, so the page does not jump as
// images load. The numbers are read from the files (the screenshots are
// regenerated from the extension and change size when it does).
function sizeImages(html) {
  return html.replace(/<img\b[^>]*\ssrc="(\/[^"]+\.png)"[^>]*>/g, (tag, src) => {
    const file = path.join(site, src);
    if (!existsSync(file)) return tag; // the link check reports it
    const png = readFileSync(file);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    return tag.replace(/\swidth="\d+"/, "").replace(/\sheight="\d+"/, "").replace(/\ssrc="/, ` width="${width}" height="${height}" src="`);
  });
}

/* --------------------------------- markdown --------------------------------- */

// Inline formatting. Code spans and links are set aside first so nothing
// inside them is touched again, then bold and italic are applied to the rest.
function inline(text) {
  const held = [];
  const hold = (html) => `\u0000${held.push(html) - 1}\u0000`;
  const anchor = (href, label) => {
    const outside = /^https?:/.test(href) && !href.startsWith(ORIGIN);
    return `<a href="${href.startsWith(ORIGIN) ? href.slice(ORIGIN.length) || "/" : href}"${outside ? ' rel="noopener"' : ""}>${label}</a>`;
  };
  let s = escape(text);
  s = s.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${code}</code>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => hold(anchor(href, label.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"))));
  s = s.replace(/https:\/\/[^\s<)]+[^\s<).,;:]/g, (href) => hold(anchor(href, href.replace(/^https:\/\//, ""))));
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
}

// Returns { meta, title, blocks }. A block is { kind, html } where kind is
// h2, h3, p, ul, ol, table or quote.
function parseMarkdown(source, { fill = false } = {}) {
  let text = source.replace(/\r\n/g, "\n");
  const meta = {};
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---", 4);
    for (const line of text.slice(4, end).split("\n")) {
      const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].trim();
    }
    text = text.slice(text.indexOf("\n", end + 1) + 1);
  }


  const lines = text.split("\n");
  const blocks = [];
  const ids = new Set();
  const starts = /^(#{1,3} |\||- |\d+\. |> |---+\s*$)/;
  let title = meta.title || "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^---+\s*$/.test(line)) {
      i++;
    } else if (line.startsWith("# ")) {
      title ||= line.slice(2).trim();
      i++;
    } else if (/^#{2,3} /.test(line)) {
      const kind = line.startsWith("### ") ? "h3" : "h2";
      const words = line.replace(/^#+ /, "").trim();
      let id = slugify(words) || "section";
      while (ids.has(id)) id += "-2";
      ids.add(id);
      blocks.push({ kind, id, words, html: kind === "h2" ? `<h2 id="${id}">${inline(words)}</h2>` : `<h3>${inline(words)}</h3>` });
      i++;
    } else if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      const [head, , ...body] = rows; // rows[1] is the |---|---| separator
      blocks.push({
        kind: "table",
        html:
          `<div class="table-scroll"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
          body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
          "</tbody></table></div>",
      });
    } else if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(`<li>${inline(lines[i].slice(2))}</li>`), i++;
      blocks.push({ kind: "ul", html: `<ul>${items.join("")}</ul>` });
    } else if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(`<li>${inline(lines[i].replace(/^\d+\. /, ""))}</li>`), i++;
      blocks.push({ kind: "ol", html: `<ol>${items.join("")}</ol>` });
    } else if (line.startsWith("> ")) {
      const quoted = [];
      while (i < lines.length && lines[i].startsWith(">")) quoted.push(lines[i].replace(/^>\s?/, "").trim()), i++;
      blocks.push({ kind: "quote", html: `<blockquote><p>${inline(quoted.filter(Boolean).join(" "))}</p></blockquote>` });
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !starts.test(lines[i])) para.push(lines[i].trim()), i++;
      blocks.push({ kind: "p", html: `<p>${inline(para.join(" "))}</p>` });
    }
  }
  return { meta, title, blocks };
}

const readDoc = async (file, options) => parseMarkdown(await readFile(file, "utf8"), options);

/* ------------------------------ shared page parts --------------------------- */

const NAV = [
  { label: "Features", href: "/#features" },
  { label: "How it works", href: "/#how" },
  { label: "Privacy", href: "/#private" },
  { label: "Blog", href: "/blog" },
  { label: "FAQ", href: "/faq" },
  { label: "Support", href: "/support" },
];
const FOOTER = [
  { title: "Product", links: [["Features", "/#features"], ["How it works", "/#how"], ["Free forever", "/#free"], ["FAQ", "/faq"]] },
  { title: "Resources", links: [["Blog", "/blog"], ["Support", "/support"], ["Contact", "/contact"]] },
  { title: "Company", links: [["About", "/about"], [MAKER, MAKER_URL]] },
  { title: "Legal", links: [["Privacy policy", "/privacy"], ["Terms and conditions", "/terms"]] },
];

function header(current) {
  const home = current === "/";
  const links = NAV.map(({ label, href }) => {
    // On the home page its own sections are a scroll away, not a page load.
    const to = home ? href.replace(/^\/#/, "#") : href;
    const here = !href.includes("#") && (current === href || current.startsWith(`${href}/`));
    return `<a href="${to}"${here ? ' class="current" aria-current="page"' : ""}>${label}</a>`;
  });
  return `<div class="top">
    <header class="nav wrap">
      <a class="logo" href="/" aria-label="${NAME} home"><img src="/favicon.svg" width="32" height="32" alt=""><span>${NAME}</span></a>
      <nav aria-label="Main">
        ${links.join("\n        ")}
      </nav>
      <a class="btn primary small" data-link="store" href="/#free">Add to Chrome</a>
      <button class="menu-btn" type="button" aria-label="Menu" aria-expanded="false"><span></span><span></span></button>
    </header>
  </div>`;
}

function footer() {
  const columns = FOOTER.map(
    ({ title, links }) => `<nav aria-label="${title}">
          <h2>${title}</h2>
          <ul>
            ${links.map(([label, href]) => `<li><a href="${href}"${href.startsWith("http") ? ' rel="noopener"' : ""}>${label}</a></li>`).join("\n            ")}
          </ul>
        </nav>`,
  );
  return `<footer class="footer">
    <div class="wrap">
      <div class="footer-cols">
        <div class="footer-about">
          <a class="logo" href="/"><img src="/favicon.svg" width="28" height="28" alt=""><span>${NAME}</span></a>
          <p>${FULL_NAME}. A product of <a href="${MAKER_URL}" rel="noopener">${MAKER}</a>, developed by Shahriar Ahmed.</p>
        </div>
        ${columns.join("\n        ")}
      </div>
      <div class="legal">
        <p>© <span data-fill="year">${new Date().getFullYear()}</span> ${MAKER}. All rights reserved.</p>
        <p>${NAME} is an independent product. It is not affiliated with or endorsed by X Corp. X and Twitter are trademarks of their owner.</p>
      </div>
    </div>
  </footer>`;
}

// Outgoing links are written into the page from config.js. (site.js sets
// them again in the browser, so a later change to config.js shows up at once.)
function fillLinks(html) {
  const contact = cfg.supportEmail ? { href: `mailto:${cfg.supportEmail}`, outside: false } : { href: cfg.contactUrl || MAKER_URL, outside: true };
  const targets = {
    store: cfg.chromeStoreUrl ? { href: cfg.chromeStoreUrl, outside: true } : null,
    contact,
  };
  return html.replace(/<a\b([^>]*\bdata-link="(store|contact)"[^>]*)>/g, (tag, attrs, kind) => {
    const target = targets[kind];
    if (!target) return tag;
    const rest = attrs.replace(/\s(?:href|target|rel)="[^"]*"/g, "");
    return `<a${rest} href="${escape(target.href)}"${target.outside ? ' target="_blank" rel="noopener"' : ""}>`;
  });
}

const organization = { "@type": "Organization", "@id": `${ORIGIN}/#maker`, name: MAKER, url: MAKER_URL };
const website = {
  "@type": "WebSite",
  "@id": `${ORIGIN}/#website`,
  url: `${ORIGIN}/`,
  name: NAME,
  alternateName: FULL_NAME,
  inLanguage: "en",
  publisher: { "@id": organization["@id"] },
};
const crumbs = (trail) => ({
  "@type": "BreadcrumbList",
  itemListElement: trail.map(([name, p], n) => ({ "@type": "ListItem", position: n + 1, name, item: url(p) })),
});

// One whole page. `trail` is the way here from the home page, as
// [name, path] pairs; it becomes the line above the heading and the
// breadcrumb in the structured data.
function page({ at, title, description, type = "website", main, schema = [], trail = null, noindex = false, article = null, share = title }) {
  const graph = [organization, website, ...(trail ? [crumbs([["Home", "/"], ...trail])] : []), ...schema];
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escape(title)}</title>`,
    `<meta name="description" content="${escape(description)}">`,
    ...(noindex
      ? ['<meta name="robots" content="noindex">']
      : [`<link rel="canonical" href="${url(at)}">`, '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">']),
    // Proof of ownership for Google Search Console and Bing Webmaster Tools.
    ...(at === "/" && cfg.googleSiteVerification ? [`<meta name="google-site-verification" content="${escape(cfg.googleSiteVerification)}">`] : []),
    ...(at === "/" && cfg.bingSiteVerification ? [`<meta name="msvalidate.01" content="${escape(cfg.bingSiteVerification)}">`] : []),
    '<meta name="theme-color" content="#0b0e11">',
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:site_name" content="${NAME}">`,
    '<meta property="og:locale" content="en_US">',
    `<meta property="og:title" content="${escape(share)}">`,
    `<meta property="og:description" content="${escape(description)}">`,
    ...(noindex ? [] : [`<meta property="og:url" content="${url(at)}">`]),
    `<meta property="og:image" content="${url(SHARE_IMAGE)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${NAME}: AI replies for X, in your own voice.">`,
    ...(article
      ? [
          `<meta property="article:published_time" content="${article.date}T00:00:00Z">`,
          `<meta property="article:modified_time" content="${article.updated}T00:00:00Z">`,
          `<meta property="article:section" content="${escape(article.tag)}">`,
        ]
      : []),
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escape(share)}">`,
    `<meta name="twitter:description" content="${escape(description)}">`,
    `<meta name="twitter:image" content="${url(SHARE_IMAGE)}">`,
    `<link rel="alternate" type="application/rss+xml" title="${NAME} blog" href="/feed.xml">`,
    '<link rel="stylesheet" href="/styles.css">',
    ...(noindex ? [] : [jsonld(graph)]),
  ];
  return fillLinks(`<!doctype html>
<html lang="en">
<head>
  ${head.join("\n  ")}
</head>
<body${at === "/" ? ' id="top"' : ""}>
  <!-- Generated by scripts/build-site.mjs. Edit the sources it names, not this file. -->
  <a class="skip" href="#main">Skip to content</a>
  ${header(at)}
${main}
  ${footer()}
  <script src="/config.js"></script>
  <script src="/site.js"></script>
  <script src="/motion.js"></script>
</body>
</html>
`);
}

// The dark band at the top of an inner page: where you are, the heading, and
// an optional line under it.
const pageHead = ({ trail, heading, lead = "", meta = "" }) => `  <div class="page-head">
    <div class="wrap narrow">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${trail
        .map(([name, p], n) => (n === trail.length - 1 ? `<span aria-current="page">${escape(name)}</span>` : `<a href="${p}">${escape(name)}</a>`))
        .join("")}</nav>
      <h1>${heading}</h1>${lead ? `\n      <p class="page-lead">${lead}</p>` : ""}${meta ? `\n      <p class="page-meta">${meta}</p>` : ""}
    </div>
  </div>`;

const closingCard = ({ heading, text, button }) => `    <section class="band alt">
      <div class="wrap narrow">
        <div class="cta-card">
          <div>
            <h2>${heading}</h2>
            <p>${text}</p>
          </div>
          <div class="actions">
            ${button}
          </div>
        </div>
      </div>
    </section>`;
const contactButton = `<a class="btn primary" data-link="contact" href="${MAKER_URL}" rel="noopener">${cfg.supportEmail ? `Email ${escape(cfg.supportEmail)}` : "Contact support"}</a>`;
const storeButton = '<a class="btn primary" data-link="store" href="/#free">Add to Chrome</a>';

/* ---------------------------------- layouts --------------------------------- */

// Reading layout: the text, on the light surface.
const reading = (blocks, { before = "", after = "" } = {}) => `  <div class="reading">
  <main id="main" class="wrap narrow prose">
    ${before}${blocks.map((b) => b.html).join("\n    ")}${after}
  </main>
  </div>`;

// Help layout: every "###" opens to its answer. Returns the HTML and the
// questions with their answers as plain text (for FAQ structured data).
function help(blocks, closing) {
  const parts = [];
  const questions = [];
  let open = null;
  const close = () => {
    if (!open) return;
    parts.push("</details>");
    questions.push({ question: open.words, answer: plain(open.answer.join(" ")) });
    open = null;
  };
  for (const block of blocks) {
    if (block.kind === "h2") {
      close();
      parts.push(block.html.replace("<h2 ", '<h2 class="help-title" '));
    } else if (block.kind === "h3") {
      close();
      parts.push(`<details><summary>${inline(block.words)}</summary>`);
      open = { words: block.words, answer: [] };
    } else if (open) {
      parts.push(block.html);
      open.answer.push(block.html);
    } else {
      parts.push(block.html.replace(/^<(p|ul|ol)>/, '<$1 class="help-text">'));
    }
  }
  close();
  return {
    questions,
    html: `  <main id="main">
    <section class="help">
      <div class="wrap narrow faq">
        ${parts.join("\n        ")}
      </div>
    </section>
${closing}
  </main>`,
  };
}

/* ------------------------------------ blog ---------------------------------- */

async function loadPosts() {
  const dir = path.join(content, "blog");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  const posts = [];
  for (const file of files) {
    const doc = await readDoc(path.join(dir, file), { fill: true });
    const slug = doc.meta.slug || file.replace(/^\d+-/, "").replace(/\.md$/, "");
    for (const key of ["title", "description", "date", "tag"]) {
      if (!doc.meta[key]) throw new Error(`content/blog/${file}: "${key}" is missing from the block at the top.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.meta.date)) throw new Error(`content/blog/${file}: date must look like 2026-11-14.`);
    const words = plain(doc.blocks.map((b) => b.html).join(" ")).split(" ").length;
    posts.push({
      slug,
      file,
      at: `/blog/${slug}`,
      title: doc.meta.title,
      description: doc.meta.description,
      date: doc.meta.date,
      updated: doc.meta.updated || doc.meta.date,
      tag: doc.meta.tag,
      related: (doc.meta.related || "").split(",").map((r) => r.trim()).filter(Boolean),
      blocks: doc.blocks,
      words,
      minutes: Math.max(1, Math.round(words / 220)),
    });
  }
  // Newest first; articles from the same day keep the order of their file names.
  return posts.sort((a, b) => (a.date === b.date ? a.file.localeCompare(b.file) : a.date < b.date ? 1 : -1));
}

const postCard = (post, level) => `          <article class="card post">
            <p class="post-tag">${escape(post.tag)}</p>
            <${level}><a href="${post.at}">${escape(post.title)}</a></${level}>
            <p>${escape(post.description)}</p>
            <p class="post-meta"><time datetime="${post.date}">${longDate(post.date)}</time> · ${post.minutes} min read</p>
          </article>`;

const postSchema = (post) => ({
  "@type": "BlogPosting",
  "@id": `${url(post.at)}#article`,
  headline: post.title,
  description: post.description,
  url: url(post.at),
  mainEntityOfPage: url(post.at),
  datePublished: `${post.date}T00:00:00Z`,
  dateModified: `${post.updated}T00:00:00Z`,
  articleSection: post.tag,
  wordCount: post.words,
  inLanguage: "en",
  image: url(SHARE_IMAGE),
  author: { "@id": organization["@id"] },
  publisher: { "@id": organization["@id"] },
  isPartOf: { "@id": `${ORIGIN}/blog#blog` },
});

function postPage(post, posts) {
  const others = posts.filter((p) => p !== post);
  const named = post.related.map((slug) => {
    const found = others.find((p) => p.slug === slug);
    if (!found) throw new Error(`content/blog/${post.file}: related article "${slug}" does not exist.`);
    return found;
  });
  // Named articles first, then the ones that follow this one in the list.
  const after = [...posts.slice(posts.indexOf(post) + 1), ...posts.slice(0, posts.indexOf(post))];
  const related = [...new Set([...named, ...after])].slice(0, 3);
  const trail = [["Blog", "/blog"], [post.title, post.at]];
  const main = `${pageHead({
    trail,
    heading: escape(post.title),
    lead: escape(post.description),
    meta: `<time datetime="${post.date}">${longDate(post.date)}</time> · ${post.minutes} min read · ${escape(post.tag)}`,
  })}
  <div class="reading">
  <main id="main" class="wrap narrow">
    <article class="prose article">
      ${post.blocks.map((b) => b.html).join("\n      ")}
    </article>
    <aside class="article-cta">
      <div>
        <h2>Try ${NAME} free</h2>
        <p>Unlimited replies in your own voice, written on your computer. ${PITCH}</p>
      </div>
      ${storeButton}
    </aside>
    <nav class="related" aria-label="More articles">
      <h2>Keep reading</h2>
      <ul>
        ${related.map((p) => `<li><a href="${p.at}">${escape(p.title)}</a><span>${p.minutes} min read</span></li>`).join("\n        ")}
      </ul>
    </nav>
  </main>
  </div>`;
  return page({
    at: post.at,
    title: post.title.length <= 50 ? `${post.title} | ${NAME}` : post.title,
    share: post.title,
    description: post.description,
    type: "article",
    article: post,
    trail,
    schema: [postSchema(post)],
    main,
  });
}

function blogIndex(posts) {
  const trail = [["Blog", "/blog"]];
  const description = "Practical guides to writing better replies, comments and threads on X (Twitter), and to using AI without sounding like it.";
  const main = `${pageHead({ trail, heading: "The XAICG blog", lead: "Practical guides to replying well on X: what to write, how often, and how to use AI without sounding like it." })}
  <main id="main">
    <section class="band blog-list">
      <div class="wrap">
        <div class="grid posts">
${posts.map((p) => postCard(p, "h2")).join("\n")}
        </div>
      </div>
    </section>
${closingCard({ heading: `Put it into practice`, text: `${NAME} drafts replies in your own voice. ${PITCH}`, button: storeButton })}
  </main>`;
  return page({
    at: "/blog",
    title: `Blog: Better Replies and Posts on X (Twitter) | ${NAME}`,
    description,
    trail,
    schema: [
      {
        "@type": "Blog",
        "@id": `${ORIGIN}/blog#blog`,
        url: url("/blog"),
        name: `The ${NAME} blog`,
        description,
        inLanguage: "en",
        publisher: { "@id": organization["@id"] },
        blogPost: posts.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: url(p.at), datePublished: `${p.date}T00:00:00Z` })),
      },
    ],
    main,
  });
}

const feed = (posts) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>The ${NAME} blog</title>
    <link>${url("/blog")}</link>
    <atom:link href="${url("/feed.xml")}" rel="self" type="application/rss+xml"/>
    <description>Practical guides to replying well on X (Twitter).</description>
    <language>en</language>
${posts
  .map(
    (p) => `    <item>
      <title>${escape(p.title)}</title>
      <link>${url(p.at)}</link>
      <guid isPermaLink="true">${url(p.at)}</guid>
      <pubDate>${new Date(`${p.date}T00:00:00Z`).toUTCString()}</pubDate>
      <description>${escape(p.description)}</description>
    </item>`,
  )
  .join("\n")}
  </channel>
</rss>
`;

/* ---------------------------------- the pages -------------------------------- */

const out = new Map(); // path inside website/ -> contents
const listed = []; // { at, lastmod? } for the sitemap

const posts = await loadPosts();

// Home.
{
  const description = `Free, unlimited AI replies and comments for X (Twitter) in your own voice. ${NAME} writes on your own computer: no sign-up, no API key, no limit.`;
  const sections = sizeImages(await readFile(path.join(content, "home.html"), "utf8")).replace(
    "{{posts}}",
    posts.slice(0, 3).map((p) => postCard(p, "h3")).join("\n"),
  );
  const app = {
    "@type": "SoftwareApplication",
    "@id": `${ORIGIN}/#app`,
    name: `${NAME}: ${FULL_NAME}`,
    alternateName: NAME,
    description,
    url: `${ORIGIN}/`,
    image: url(SHARE_IMAGE),
    applicationCategory: "BrowserApplication",
    applicationSubCategory: "Chrome extension",
    operatingSystem: "Chrome",
    browserRequirements: "Requires desktop Google Chrome 138 or newer on Windows, macOS, Linux or a Chromebook Plus",
    softwareVersion: VERSION,
    ...(cfg.chromeStoreUrl ? { installUrl: cfg.chromeStoreUrl } : {}),
    author: { "@id": organization["@id"] },
    publisher: { "@id": organization["@id"] },
    featureList: [
      "One-click AI replies and questions on any post on X",
      "Nine tones, including Auto",
      "Posts, threads and rewrites from the toolbar popup",
      "A persona that keeps drafts in your own voice",
      "Unlimited and free: no sign-up, no API key",
      "Private: the AI runs on your own computer",
      "English, Spanish, German, French and Japanese",
      "Nothing is posted without you",
    ],
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", availability: "https://schema.org/InStock", description: "Free forever, unlimited" },
  };
  out.set(
    "index.html",
    page({
      at: "/",
      title: `Free AI Reply Generator for X (Twitter) | ${NAME} Extension`,
      share: `${NAME}: Free, Unlimited AI Replies for X (Twitter)`,
      description,
      schema: [app],
      main: `\n  <main id="main">\n${sections}  </main>\n`,
    }),
  );
  listed.push({ at: "/" });
}

// Pages written in Markdown.
const documents = [
  {
    source: "PRIVACY-POLICY.md",
    at: "/privacy",
    name: "Privacy Policy",
    title: `Privacy Policy | ${NAME}`,
    description: `What ${NAME} reads on X, what stays on your computer, the counts its server keeps and why, and the choices you have. In plain language.`,
  },
  {
    source: "TERMS.md",
    at: "/terms",
    name: "Terms and Conditions",
    title: `Terms and Conditions | ${NAME}`,
    description: `The terms for using ${NAME}, the free AI reply generator for X: what it does, acceptable use, and your responsibility for what you post.`,
  },
  {
    source: "SUPPORT.md",
    at: "/support",
    name: "Support",
    title: `Support and Help | ${NAME}`,
    description: `Help with ${NAME}: setting up the on-device AI, computer requirements, the AI Reply buttons on X, languages, privacy, and how to reach a person.`,
    layout: "help",
    closing: closingCard({ heading: "Still stuck?", text: "Write to us and a person will read it.", button: contactButton }),
  },
  {
    source: "content/faq.md",
    at: "/faq",
    name: "FAQ",
    title: `FAQ: AI Replies for X, Free Plan and Privacy | ${NAME}`,
    layout: "help",
    faq: true,
    closing: closingCard({ heading: "Did not find your answer?", text: `The support page has step-by-step fixes, and you can write to us.`, button: '<a class="btn primary" href="/support">Open support</a>' }),
  },
  { source: "content/about.md", at: "/about", name: "About", title: `About ${NAME} and ${MAKER}`, closing: closingCard({ heading: `Try ${NAME}`, text: `Replies in your own voice, written on your computer. ${PITCH}`, button: storeButton }) },
  { source: "content/contact.md", at: "/contact", name: "Contact", title: `Contact ${NAME} Support`, closing: closingCard({ heading: "Write to us", text: "A person reads every message.", button: contactButton }) },
];

for (const d of documents) {
  const fromContent = d.source.startsWith("content/");
  const doc = await readDoc(path.join(root, d.source), { fill: fromContent });
  // "Privacy Policy: the product's full name" -> the heading and a line under it.
  const [first, ...rest] = doc.title.split(":");
  const name = d.name || first.trim();
  const description = d.description || doc.meta.description;
  if (!description) throw new Error(`${d.source} needs a description.`);
  const trail = [[name, d.at]];
  const top = pageHead({ trail, heading: escape(first.trim()), lead: doc.meta.lead ? inline(doc.meta.lead) : "" });
  let main;
  const schema = [];
  if (d.layout === "help") {
    const built = help(doc.blocks, d.closing);
    main = `${top}\n${built.html}`;
    if (d.faq) {
      schema.push({
        "@type": "FAQPage",
        "@id": `${url(d.at)}#faq`,
        mainEntity: built.questions.map((q) => ({ "@type": "Question", name: q.question, acceptedAnswer: { "@type": "Answer", text: q.answer } })),
      });
    }
  } else {
    const subtitle = rest.length ? `<p><strong>${inline(rest.join(":").trim())}</strong></p>\n    ` : "";
    main = `${top}\n${reading(doc.blocks, { before: subtitle })}${d.closing ? `\n${d.closing}` : ""}`;
    if (d.at === "/about") schema.push({ "@type": "AboutPage", "@id": `${url(d.at)}#page`, url: url(d.at), name: doc.title, about: { "@id": `${ORIGIN}/#app` } });
    if (d.at === "/contact") schema.push({ "@type": "ContactPage", "@id": `${url(d.at)}#page`, url: url(d.at), name: doc.title });
  }
  out.set(`${d.at.slice(1)}.html`, page({ at: d.at, title: d.title, description, trail, schema, main }));
  listed.push({ at: d.at });
}

// Blog.
out.set("blog/index.html", blogIndex(posts));
listed.push({ at: "/blog", lastmod: posts.map((p) => p.updated).sort().at(-1) });
for (const post of posts) {
  out.set(`blog/${post.slug}.html`, postPage(post, posts));
  listed.push({ at: post.at, lastmod: post.updated });
}
out.set("feed.xml", feed(posts));

// Not found.
out.set(
  "404.html",
  page({
    at: "/404",
    title: `Page not found | ${NAME}`,
    description: "That page is not here.",
    noindex: true,
    main: `  <main id="main" class="notfound">
    <h1 class="display-lg">That page isn't here.</h1>
    <p>The address may be mistyped, or the page may have moved.</p>
    <div class="actions"><a class="btn primary lg" href="/">Go to the ${NAME} home page</a><a class="btn lg" href="/blog">Read the blog</a></div>
  </main>`,
  }),
);

// For search engines.
out.set("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${url("/sitemap.xml")}\n`);
out.set(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    listed.map(({ at, lastmod }) => `  <url><loc>${url(at)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`).join("\n") +
    "\n</urlset>\n",
);

/* ---------------------------------- checks ---------------------------------- */

// Every link between the pages has to lead somewhere, and every page needs
// what a search result is made from.
const problems = [];
const exists = (file) => out.has(file) || existsSync(path.join(site, file));
const fileFor = (p) => {
  const clean = p.replace(/^\//, "");
  if (clean === "") return "index.html";
  for (const candidate of [clean, `${clean}.html`, `${clean}/index.html`]) if (exists(candidate)) return candidate;
  return null;
};
const seenTitles = new Map();
for (const [file, html] of out) {
  if (!file.endsWith(".html")) continue;
  for (const [, target] of html.matchAll(/\s(?:href|src)="(\/[^"]*)"/g)) {
    const [p, hash] = target.split("#");
    const found = fileFor(p);
    if (!found) problems.push(`${file}: link to ${target} leads nowhere`);
    else if (hash && found.endsWith(".html") && !(out.get(found) || "").includes(`id="${hash}"`)) problems.push(`${file}: ${target} has no element with id="${hash}"`);
  }
  for (const [, hash] of html.matchAll(/\shref="#([^"]+)"/g)) {
    if (!html.includes(`id="${hash}"`)) problems.push(`${file}: #${hash} has no element with that id`);
  }
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] || "";
  const description = html.match(/<meta name="description" content="([^"]*)">/)?.[1] || "";
  if (file !== "404.html") {
    if (title.length < 20 || title.length > 65) problems.push(`${file}: title is ${title.length} characters (aim for 20 to 65): ${title}`);
    if (description.length < 70 || description.length > 165) problems.push(`${file}: description is ${description.length} characters (aim for 70 to 165)`);
    if (seenTitles.has(title)) problems.push(`${file}: same title as ${seenTitles.get(title)}`);
    seenTitles.set(title, file);
  }
  if ((html.match(/<h1[\s>]/g) || []).length !== 1) problems.push(`${file}: needs exactly one <h1>`);
  for (const [img] of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt="/.test(img) || !/\swidth="/.test(img) || !/\sheight="/.test(img)) problems.push(`${file}: an image is missing alt, width or height: ${img.slice(0, 80)}`);
  }
  if (/\{\{\w/.test(html)) problems.push(`${file}: an unfilled {{...}} is left in the page`);
}
if (problems.length) {
  console.error(`The site was not written, because of ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n - ${problems.join("\n - ")}`);
  process.exit(1);
}

/* ----------------------------------- write ---------------------------------- */

// Articles that no longer have a source go away.
await rm(path.join(site, "blog"), { recursive: true, force: true });
await mkdir(path.join(site, "blog"), { recursive: true });
for (const [file, text] of out) await writeFile(path.join(site, file), text);

console.log(`Built ${[...out.keys()].filter((f) => f.endsWith(".html")).length} pages for ${ORIGIN}:`);
console.log(`  home, ${documents.length} pages from Markdown, the blog with ${posts.length} article${posts.length === 1 ? "" : "s"}, 404`);
console.log("  sitemap.xml, robots.txt, feed.xml");
console.log("Every link between them was followed. Commit and push, and Vercel redeploys.");
