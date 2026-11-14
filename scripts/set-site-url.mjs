#!/usr/bin/env node
// Tell the website its own public address.
//
//   node scripts/set-site-url.mjs https://xaigc.example
//
// Link previews (X, Slack, WhatsApp...) and search engines need full
// addresses, which the site cannot know until it has a domain. This writes
// them into website/index.html, website/robots.txt and website/sitemap.xml.
// Run it once after the first Vercel deploy, and again if the domain changes.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const site = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "website");

const input = process.argv[2];
let url;
try {
  url = new URL(input);
} catch {
  console.error("Usage: node scripts/set-site-url.mjs https://your-site.example");
  process.exit(1);
}
if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
  console.error("Give only the https origin, for example https://xaigc.example (no path).");
  process.exit(1);
}
const origin = url.origin;

// ---- index.html: preview image, page address, canonical link -------------------

const indexPath = path.join(site, "index.html");
let html = await readFile(indexPath, "utf8");

const image = /<meta property="og:image" content="[^"]*">/;
if (!image.test(html)) {
  console.error("Could not find the og:image tag in website/index.html.");
  process.exit(1);
}
// Remove what an earlier run added, then write all three together.
html = html.replace(/\n\s*<meta property="og:url" content="[^"]*">/, "").replace(/\n\s*<link rel="canonical" href="[^"]*">/, "");
html = html.replace(
  image,
  `<meta property="og:image" content="${origin}/assets/og.png">\n` +
    `  <meta property="og:url" content="${origin}/">\n` +
    `  <link rel="canonical" href="${origin}/">`,
);
await writeFile(indexPath, html);

// ---- robots.txt and sitemap.xml ---------------------------------------------------

await writeFile(path.join(site, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
await writeFile(
  path.join(site, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>${origin}/</loc></url>\n` +
    `  <url><loc>${origin}/privacy</loc></url>\n` +
    `</urlset>\n`,
);

console.log(`Website address set to ${origin}`);
console.log("  website/index.html   (link preview image, page address)");
console.log("  website/robots.txt");
console.log("  website/sitemap.xml");
console.log("Commit and push, and Vercel redeploys.");
