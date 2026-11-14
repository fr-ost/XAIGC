#!/usr/bin/env node
// Point the extension at your deployed XAICG server.
//
//   node scripts/set-api-url.mjs https://your-app.up.railway.app
//
// Updates API_BASE in extension/config.js and the matching host permission in
// extension/manifest.json, which must always agree.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "extension", "config.js");
const manifestPath = path.join(root, "extension", "manifest.json");
const X_HOSTS = ["https://x.com/*", "https://twitter.com/*"];

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/set-api-url.mjs https://your-server.example");
  process.exit(1);
}

let url;
try {
  url = new URL(input);
} catch {
  console.error(`"${input}" is not a valid URL.`);
  process.exit(1);
}
const local = ["localhost", "127.0.0.1"].includes(url.hostname);
if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
  console.error("The server URL must use https (http is allowed only for localhost).");
  process.exit(1);
}
if (url.pathname !== "/" || url.search || url.hash) {
  console.error("Give only the origin, for example https://your-app.up.railway.app (no path).");
  process.exit(1);
}
const origin = url.origin;

const config = await readFile(configPath, "utf8");
const pattern = /export const API_BASE = "[^"]*";/;
if (!pattern.test(config)) {
  console.error("Could not find API_BASE in extension/config.js.");
  process.exit(1);
}
await writeFile(configPath, config.replace(pattern, `export const API_BASE = "${origin}";`));

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions = [...X_HOSTS, `${origin}/*`];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Extension now points at ${origin}`);
console.log("Reload the extension at chrome://extensions to pick up the change.");
