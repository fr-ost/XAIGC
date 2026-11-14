#!/usr/bin/env node
// Tell the website its own public address, and rebuild it.
//
//   node scripts/set-site-url.mjs https://xaicg.example
//
// Link previews (X, Slack, WhatsApp...) and search engines need full
// addresses. This writes the address into website/config.js and runs
// scripts/build-site.mjs, which puts it into every page, the sitemap,
// robots.txt and the blog's feed. Run it again if the domain changes.

import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(here, "..", "website", "config.js");

let url;
try {
  url = new URL(process.argv[2]);
} catch {
  console.error("Usage: node scripts/set-site-url.mjs https://your-site.example");
  process.exit(1);
}
if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
  console.error("Give only the https origin, for example https://xaicg.example (no path).");
  process.exit(1);
}

const config = await readFile(configPath, "utf8");
const line = /siteUrl:\s*"[^"]*"/;
if (!line.test(config)) {
  console.error("Could not find siteUrl in website/config.js.");
  process.exit(1);
}
await writeFile(configPath, config.replace(line, `siteUrl: "${url.origin}"`));
console.log(`Website address set to ${url.origin} in website/config.js. Rebuilding the pages...`);

const build = spawnSync(process.execPath, [path.join(here, "build-site.mjs")], { stdio: "inherit" });
process.exit(build.status ?? 1);
