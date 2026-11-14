#!/usr/bin/env node
// Renders store/icon.svg into every icon file the extension and the website use.
//
//   node store/build-icons.mjs
//
// Needs Playwright with Chromium, like store/generate.mjs. Run it after
// changing icon.svg, then run store/generate.mjs so the store images pick the
// new icon up.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(path.join(ROOT, "store", "icon.svg"), "utf8");

// Small sizes fill the whole square so they stay legible in the toolbar. The
// 128px icon keeps a transparent margin, which is what the Web Store asks for.
const targets = [
  { file: "extension/icons/icon16.png", size: 16, margin: 0 },
  { file: "extension/icons/icon32.png", size: 32, margin: 0 },
  { file: "extension/icons/icon48.png", size: 48, margin: 2 },
  { file: "extension/icons/icon128.png", size: 128, margin: 12 },
  { file: "website/assets/icon-32.png", size: 32, margin: 0 },
  { file: "website/assets/icon-48.png", size: 48, margin: 0 },
  { file: "website/assets/icon-128.png", size: 128, margin: 0 },
];

const browser = await chromium.launch();
for (const { file, size, margin } of targets) {
  const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size - margin * 2}px;height:${size - margin * 2}px;margin:${margin}px}</style>${svg}`,
  );
  const out = path.join(ROOT, file);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, await page.screenshot({ type: "png", omitBackground: true }));
  await context.close();
  console.log(`  ${file}  ${size}x${size}`);
}
await browser.close();
