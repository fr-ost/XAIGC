#!/usr/bin/env node
// Renders store/icon.svg into every icon file the extension and the website use.
//
//   node store/build-icons.mjs
//
// Needs Playwright with Chromium, like store/generate.mjs. Run it after
// changing icon.svg, then run store/generate.mjs so the store images pick the
// new icon up.
//
// Extension   extension/icons/icon{16,32,48,128}.png
// Website     website/favicon.svg           the logo in the header, and the tab icon in modern browsers
//             website/favicon.ico           the tab icon everywhere else (16, 32 and 48px inside)
//             website/apple-touch-icon.png  180x180, for an iPhone or iPad home screen

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(path.join(ROOT, "store", "icon.svg"), "utf8");
// The colour of the icon's tile, for surfaces that cannot be transparent.
const tile = /<rect[^>]*fill="([^"]+)"/.exec(svg)?.[1] || "#000000";

const browser = await chromium.launch();

// Draw the icon at `size`, with `margin` clear pixels around it. With a
// `background` the square is filled edge to edge instead of left transparent.
async function render(size, margin = 0, background = null) {
  const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(
    `<style>html,body{margin:0;background:${background || "transparent"}}svg{display:block;width:${size - margin * 2}px;height:${size - margin * 2}px;margin:${margin}px}</style>${svg}`,
  );
  const png = await page.screenshot({ type: "png", omitBackground: !background });
  await context.close();
  return png;
}

async function save(file, data, note) {
  const out = path.join(ROOT, file);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, data);
  console.log(`  ${file.padEnd(34)} ${note}`);
}

// An .ico file is a small directory followed by the images themselves, which
// may be ordinary PNGs.
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0); // width
    entry.writeUInt8(size, 1); // height
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// Small sizes fill the whole square so they stay legible in the toolbar. The
// 128px icon keeps a transparent margin, which is what the Web Store asks for.
await save("extension/icons/icon16.png", await render(16), "16x16");
await save("extension/icons/icon32.png", await render(32), "32x32");
await save("extension/icons/icon48.png", await render(48, 2), "48x48");
await save("extension/icons/icon128.png", await render(128, 12), "128x128");

await save("website/favicon.svg", svg, "vector");
await save(
  "website/favicon.ico",
  ico([
    { size: 16, png: await render(16) },
    { size: 32, png: await render(32) },
    { size: 48, png: await render(48) },
  ]),
  "16, 32 and 48px",
);
// iOS rounds the corners itself and shows black where an icon is
// transparent, so this one is a full square in the tile's colour.
await save("website/apple-touch-icon.png", await render(180, 0, tile), "180x180");

await browser.close();
