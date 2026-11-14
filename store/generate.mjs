#!/usr/bin/env node
// Builds the Chrome Web Store images and the product website's screenshots.
//
//   node store/generate.mjs
//
// Needs Playwright with Chromium (npm i -D playwright && npx playwright
// install chromium). Nothing else: no server, no Chrome profile, no X account.
// The real extension pages and content script are loaded from this repository
// and fed sample data through store/scenes/chrome-shim.js, so the images show
// the actual product. Run it again after changing the extension's UI.
//
// Output
//   store/assets/screenshot-{1..5}.png   1280x800  store screenshots
//   store/assets/promo-small.png         440x280   small promo tile
//   store/assets/promo-marquee.png       1400x560  marquee promo tile
//   store/assets/icon-128.png            128x128   store icon
//   website/assets/og.png                1200x630  link preview image
//   website/assets/shots/*.png           raw UI captures at 2x for the site

import { createServer } from "node:http";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import zlib from "node:zlib";

const { chromium } = createRequire(import.meta.url)("playwright");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORE_OUT = path.join(ROOT, "store", "assets");
const SITE_OUT = path.join(ROOT, "website", "assets");
const VERSION = JSON.parse(await readFile(path.join(ROOT, "extension", "manifest.json"), "utf8")).version;

/* ------------------------------ sample data ------------------------------ */

const user = { name: "Alex Rivera", email: "alex.rivera@example.com" };
const links = { buy: "https://uniquelabs.org", support: "https://uniquelabs.org", website: "https://uniquelabs.org" };
const auth = { google: true, signInRequired: false };

const trialAccount = {
  plan: "trial", planLabel: "Free trial", licensed: false, license: null, notice: null, accountLicense: null, user, auth, links,
  quota: { scope: "trial", limit: 20, used: 3, remaining: 17, resetsAt: null },
};
const proAccount = {
  plan: "pro", planLabel: "Pro", licensed: true, notice: null, accountLicense: null, user, auth, links,
  license: { hint: "XAICG-7K2QM-*****-*****-**VNE", state: "active", plan: "Pro", expiresAt: "2027-06-30T00:00:00.000Z", devicesUsed: 1, maxDevices: 2 },
  quota: { scope: "day", limit: 200, used: 38, remaining: 162, resetsAt: "2027-01-01T00:00:00.000Z" },
};

const replies = {
  reply: [
    "Cheaper is nice, but the bridge has to stay up on a busy day for the cut to mean anything.",
    "Withdrawals being included is the part that actually changes my week.",
    "An 80% cut usually means someone else is paying. Who is it this time?",
  ],
  question: ["Does the cut apply to withdrawals on every chain?"],
  post: [
    "Shipping something small every week beats one perfect launch a year.",
    "Weekly small releases taught me more than any roadmap ever did.",
    "Plans feel productive. Shipping is the part that actually teaches you.",
  ],
  thread: [
    "Most launch plans fail on the boring part: getting it in front of people.",
    "In year one, distribution beats features. A plain product people hear about wins over a great one nobody finds.",
    "Pick one channel and stay there until it works. Spreading thin feels busy and moves nothing.",
    "Ship small, weekly, and let what people actually use decide the roadmap.",
  ],
};

const settings = {
  tone: "skeptical", length: "medium", language: "en", emoji: "auto", outputMode: "insert", showQuestionButton: true,
  persona: "Founder voice: opinionated, blunt, slightly dry. One real point per reply, no fluff, no praise.",
};

const popupPosts = { mode: "post", inputs: { post: "shipping small things weekly beats one big launch", thread: "", rewrite: "" }, tone: "", size: "medium", tweets: "5", result: { kind: "post", items: replies.post } };
const popupThread = { mode: "thread", inputs: { post: "", thread: "why distribution beats features in year one", rewrite: "" }, tone: "", size: "medium", tweets: "4", result: { kind: "thread", items: replies.thread } };

// What each page finds in extension storage. `frames` overrides it per iframe
// name, so one screenshot can show two popups in different states.
const preview = (storage, frames = {}) => ({ version: VERSION, deviceId: "4b7c1d2e-9a53-4f08-b6c1-7d2e5a903c41", replies, storage, frames });
const TRIAL = preview({ account: trialAccount, settings: { outputMode: "insert", showQuestionButton: true } });
const PRO = preview({ account: proAccount, settings, popupState: popupPosts }, { thread: { popupState: popupThread } });

/* ------------------------------ PNG without alpha ------------------------- */

// The Web Store wants 24-bit PNGs. Chromium writes 32-bit ones, so the alpha
// channel (always fully opaque here) is dropped and the image re-encoded.
function toRgbPng(buf) {
  let pos = 8;
  const chunks = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    chunks.push({ type: buf.toString("latin1", pos + 4, pos + 8), data: buf.subarray(pos + 8, pos + 8 + len) });
    pos += 12 + len;
  }
  const ihdr = chunks.find((c) => c.type === "IHDR").data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  if (ihdr[9] === 2) return buf; // already RGB
  if (ihdr[8] !== 8 || ihdr[9] !== 6 || ihdr[12] !== 0) throw new Error("unexpected PNG format");

  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const stride = width * 4;
  const out = Buffer.alloc(height * (1 + width * 3));
  let prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);
  let prevRgb = Buffer.alloc(width * 3);
  for (let y = 0; y < height; y++) {
    const off = y * (stride + 1);
    const filter = raw[off];
    for (let x = 0; x < stride; x++) {
      const v = raw[off + 1 + x];
      const a = x >= 4 ? cur[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = (v + add) & 255;
    }
    const rgb = Buffer.alloc(width * 3);
    for (let x = 0; x < width; x++) {
      rgb[x * 3] = cur[x * 4];
      rgb[x * 3 + 1] = cur[x * 4 + 1];
      rgb[x * 3 + 2] = cur[x * 4 + 2];
    }
    // "Up" filtering: flat UI repeats row to row, which compresses well.
    const o = y * (1 + width * 3);
    out[o] = 2;
    for (let x = 0; x < width * 3; x++) out[o + 1 + x] = (rgb[x] - prevRgb[x]) & 255;
    prevRgb = rgb;
    [prev, cur] = [cur, prev];
  }

  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.from(ihdr);
  header[9] = 2;
  return Buffer.concat([buf.subarray(0, 8), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(out, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

async function save(file, buffer) {
  await mkdir(path.dirname(file), { recursive: true });
  const png = toRgbPng(buffer);
  await writeFile(file, png);
  console.log(`  ${path.relative(ROOT, file).padEnd(40)} ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}  ${(png.length / 1024).toFixed(0)} KB`);
}

/* ------------------------------ static server ----------------------------- */

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(ROOT)) throw new Error("outside root");
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* -------------------------------- capture --------------------------------- */

const browser = await chromium.launch();
const shim = await readFile(path.join(ROOT, "store", "scenes", "chrome-shim.js"), "utf8");

async function open({ width, height, scale = 1, data }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: "light", reducedMotion: "reduce" });
  // Runs in every frame before the page's own scripts. An iframe picks its
  // own storage overrides by name.
  await context.addInitScript(`(() => { const p = ${JSON.stringify(data)}; const mine = p.frames[window.name] || {}; window.__XAICG_PREVIEW = { ...p, storage: { ...p.storage, ...mine } }; })();\n${shim}`);
  const page = await context.newPage();
  page.on("pageerror", (err) => console.warn("  page error:", err.message));
  return { context, page };
}

const settle = (page, ms = 350) => page.waitForTimeout(ms);

// Scroll a framed page so `selector` sits near the top. window.scrollTo, not
// scrollIntoView: the latter also scrolls the screenshot page around the frame.
const scrollFrameTo = (page, frame, selector, gap = 12) =>
  page.frameLocator(`iframe[name="${frame}"]`).locator(selector).first().evaluate((el, g) => {
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - g);
  }, gap);
const TIMELINE = `${BASE}/store/scenes/timeline.html`;
const POPUP = `${BASE}/extension/popup.html`;
const OPTIONS = `${BASE}/extension/options.html`;

// Drive the sample timeline: draft a reply into the box, or open the tone menu.
async function draftReply(target) {
  await target.locator("article").first().locator(".xaicg-btn.ai").click();
  await target.locator(".xaicg-regen").waitFor();
}
async function openTones(target) {
  await target.locator("article").first().locator(".xaicg-btn.more").click();
  await target.locator(".xaicg-menu").waitFor();
}

async function shot(n, spec, data, act) {
  const { context, page } = await open({ width: 1280, height: 800, data });
  await page.goto(`${BASE}/store/scenes/shot.html?spec=${encodeURIComponent(JSON.stringify(spec))}`);
  await page.waitForLoadState("networkidle");
  if (act) await act(page);
  await settle(page);
  await save(path.join(STORE_OUT, `screenshot-${n}.png`), await page.screenshot({ type: "png" }));
  await context.close();
}

console.log(`XAICG ${VERSION}: store screenshots`);

await shot(1, {
  badge: "One click",
  headline: "Reply on X in *your own voice*",
  sub: "XAICG drafts the reply and types it into the box. You read it, then you post it.",
  points: ["Typed straight into X's reply box", "Sounds like you, not like an AI", "Nothing is ever posted for you"],
  frames: [{ name: "x", src: TIMELINE, width: 660, height: 560, x: 40, y: 122 }],
  callouts: [
    { text: "3 drafts from every click", icon: "3", x: 380, y: 78, rotate: 3 },
    { text: "Try another, free", icon: "↻", x: 36, y: 668, rotate: -3, dark: true },
  ],
}, TRIAL, (page) => draftReply(page.frameLocator('iframe[name="x"]')));

await shot(2, {
  badge: "9 tones",
  headline: "A tone for *every moment*",
  sub: "Leave it on Auto and each post decides. Or pick the one you want.",
  chips: ["!Auto", "Casual", "Witty", "Supportive", "Skeptical", "Analytical", "Blunt", "Technical", "Professional"],
  frames: [{ name: "x", src: TIMELINE, width: 660, height: 600, x: 40, y: 100 }],
  callouts: [{ text: "Asks a sharp question too", icon: "?", x: 30, y: 60, rotate: -3 }],
}, TRIAL, (page) => openTones(page.frameLocator('iframe[name="x"]')));

await shot(3, {
  badge: "Compose",
  headline: "Posts and threads from *a rough idea*",
  sub: "Say what it should be about. Copy a draft, or open it in X ready to post.",
  points: ["Posts in three lengths", "Threads of three to eight posts", "Rewrites that keep your facts"],
  frames: [
    { name: "posts", src: POPUP, width: 380, height: 640, chrome: "popup", x: 10, y: 96, rotate: -4, tilt: -6, scale: 0.94, z: 2 },
    { name: "thread", src: POPUP, width: 380, height: 640, chrome: "popup", x: 318, y: 132, rotate: 4, tilt: -10, scale: 0.94, z: 1 },
  ],
  callouts: [{ text: "From one line of an idea", icon: "✦", x: 250, y: 44, rotate: 3, dark: true }],
}, PRO, async (page) => {
  // Start at the compose card, so the idea and the drafts it produced both show.
  await scrollFrameTo(page, "posts", ".compose");
  await scrollFrameTo(page, "thread", ".compose");
});

await shot(4, {
  badge: "Your voice",
  headline: "Make it *sound like you*",
  sub: "Describe how you write once. It shapes every reply, post and thread.",
  points: ["A persona in your own words", "Reply length, language and emoji", "18 languages to write in"],
  frames: [{ name: "voice", src: OPTIONS, width: 800, height: 600, x: 10, y: 96, scale: 0.86, tilt: -11 }],
  callouts: [{ text: "Remembers your last drafts, so it never repeats", icon: "✓", x: 150, y: 690, rotate: -2 }],
}, PRO, (page) => scrollFrameTo(page, "voice", "section:has(#persona)", 18));

await shot(5, {
  badge: "Free trial · 20 generations",
  headline: "Start free. Your plan *follows you*",
  sub: "Sign in with Google and it is there on every browser you use. No key to type, no API key to find.",
  chips: ["Starter $0.99", "!Pro $1.99", "Agency $4.99"],
  frames: [
    { name: "account", src: OPTIONS, width: 760, height: 600, x: -6, y: 70, scale: 0.8, tilt: -10, z: 1 },
    { name: "posts", src: POPUP, width: 380, height: 520, chrome: "popup", x: 330, y: 250, scale: 0.9, rotate: 3, tilt: -8, z: 2 },
  ],
  callouts: [{ text: "per month", x: 0, y: 0, rotate: 0, hidden: true }].filter((c) => !c.hidden),
}, PRO);

console.log("promo tiles");
for (const [size, width, height, file] of [
  ["small", 440, 280, path.join(STORE_OUT, "promo-small.png")],
  ["marquee", 1400, 560, path.join(STORE_OUT, "promo-marquee.png")],
  ["og", 1200, 630, path.join(SITE_OUT, "og.png")],
]) {
  const { context, page } = await open({ width, height, data: TRIAL });
  await page.goto(`${BASE}/store/scenes/promo.html?size=${size}`);
  await settle(page, 200);
  await save(file, await page.screenshot({ type: "png" }));
  await context.close();
}
await copyFile(path.join(ROOT, "extension", "icons", "icon128.png"), path.join(STORE_OUT, "icon-128.png"));

console.log("website screenshots (2x)");
const SHOTS = path.join(SITE_OUT, "shots");

for (const [name, act, height] of [["reply", draftReply, 520], ["tones", openTones, 640]]) {
  const { context, page } = await open({ width: 700, height, scale: 2, data: TRIAL });
  await page.goto(TIMELINE);
  await act(page);
  await settle(page);
  await save(path.join(SHOTS, `${name}.png`), await page.screenshot({ type: "png" }));
  await context.close();
}

for (const [name, state] of [["compose", popupPosts], ["thread", popupThread]]) {
  const { context, page } = await open({ width: 380, height: 700, scale: 2, data: preview({ account: proAccount, settings, popupState: state }) });
  await page.goto(POPUP);
  await page.locator("#resultList li").first().waitFor();
  await settle(page);
  await save(path.join(SHOTS, `${name}.png`), await page.screenshot({ type: "png", fullPage: true }));
  await context.close();
}

{
  const { context, page } = await open({ width: 800, height: 900, scale: 2, data: PRO });
  await page.goto(OPTIONS);
  await page.locator("#signedIn").waitFor();
  await settle(page);
  await save(path.join(SHOTS, "voice.png"), await page.locator("#persona").locator("xpath=ancestor::section").screenshot({ type: "png" }));
  // Bounding boxes are relative to the viewport and the capture above scrolled it; a full-page clip is not.
  const scrollY = await page.evaluate(() => window.scrollY);
  const a = await page.locator("#account").boundingBox();
  const b = await page.locator("#license").boundingBox();
  const clip = { x: a.x, y: a.y + scrollY, width: a.width, height: b.y + b.height - a.y };
  await save(path.join(SHOTS, "account.png"), await page.screenshot({ type: "png", clip, fullPage: true }));
  await context.close();
}

await browser.close();
server.close();
console.log("done");
