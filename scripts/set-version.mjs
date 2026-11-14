#!/usr/bin/env node
// Set the product version everywhere it lives.
//
//   node scripts/set-version.mjs 3.2.0
//
// Updates the extension manifest (what Chrome and the Web Store see) and the
// server package (what /health and the admin dashboard report). The server
// reads its version from server/package.json, so nothing else needs editing.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

// Chrome accepts one to four dot-separated numbers; npm needs exactly three.
if (!/^\d+\.\d+\.\d+$/.test(version || "")) {
  console.error("Usage: node scripts/set-version.mjs MAJOR.MINOR.PATCH   (for example 3.2.0)");
  process.exit(1);
}

async function updateJson(file, change) {
  const full = path.join(root, file);
  const json = JSON.parse(await readFile(full, "utf8"));
  change(json);
  await writeFile(full, JSON.stringify(json, null, 2) + "\n");
  console.log(`  ${file}`);
}

console.log(`Setting version ${version}:`);
await updateJson("extension/manifest.json", (m) => {
  m.version = version;
});
await updateJson("server/package.json", (p) => {
  p.version = version;
});
await updateJson("server/package-lock.json", (lock) => {
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
});
console.log("Reload the extension at chrome://extensions, and redeploy the server, to pick it up.");
