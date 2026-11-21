#!/usr/bin/env node
// Give the extension its Google sign-in client.
//
//   node scripts/set-google-client.mjs 1234-abc.apps.googleusercontent.com
//   node scripts/set-google-client.mjs 1234-abc.apps.googleusercontent.com --key "MIIBIjANBg..."
//   node scripts/set-google-client.mjs --edition unlimited 5678-def.apps.googleusercontent.com
//
// The client ID comes from Google Cloud: an OAuth client of type "Chrome
// Extension", created for this extension's ID (see SETUP.md, Part 3). Set
// the same value as GOOGLE_CLIENT_ID on the server.
//
// --key is optional. It is the extension's public key from the Chrome Web
// Store dashboard (Package, View public key). With it in the manifest, a copy
// loaded unpacked gets the same ID as the published extension, so Google
// sign-in works while you test. It is left out of the zip you upload.
//
// --edition gives another edition (editions/<name>/) its own client. Each
// edition is its own item in the Chrome Web Store with its own ID, and a
// Chrome Extension OAuth client belongs to exactly one ID. List every
// edition's client in GOOGLE_CLIENT_ID on the server, separated by commas.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "extension", "manifest.json");
const args = process.argv.slice(2);
const valueOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] || "" : null;
};
const key = valueOf("--key") === null ? null : valueOf("--key").replace(/\s+/g, "");
const edition = valueOf("--edition");
const taken = new Set(["--key", "--edition"].flatMap((name) => (args.indexOf(name) >= 0 ? [args.indexOf(name), args.indexOf(name) + 1] : [])));
const clientId = args.filter((_, i) => !taken.has(i))[0] || "";

const fail = (message) => {
  console.error(message);
  process.exit(1);
};
if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
  fail(
    "Usage: node scripts/set-google-client.mjs <client-id> [--key <public key>]\n" +
      "The client ID ends in .apps.googleusercontent.com. (The client secret is not used.)",
  );
}
if (key !== null && !/^[A-Za-z0-9+/]{100,}={0,2}$/.test(key)) {
  fail("--key should be the public key from the store dashboard: one long line of letters and digits, without the BEGIN/END lines.");
}

if (edition !== null) {
  const file = path.join(root, "editions", edition, "edition.json");
  if (!/^[a-z0-9-]+$/.test(edition) || !existsSync(file)) fail(`There is no edition called "${edition}".`);
  if (key !== null) fail("--key applies to the standard edition's manifest only.");
  const settings = JSON.parse(await readFile(file, "utf8"));
  settings.googleClientId = clientId;
  await writeFile(file, JSON.stringify(settings, null, 2) + "\n");
  console.log(`${settings.title || edition}: Google sign-in client set to ${clientId}`);
  console.log("Add it to GOOGLE_CLIENT_ID on the server, after the standard edition's, separated by a comma. Then build:");
  console.log(`  node scripts/pack-extension.mjs --edition ${edition}`);
  process.exit(0);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!manifest.permissions.includes("identity")) manifest.permissions.push("identity");
manifest.oauth2 = { client_id: clientId, scopes: ["openid", "email", "profile"] };
if (key) manifest.key = key;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Google sign-in client set to ${clientId}`);
if (key) console.log("Public key added: an unpacked copy now has the same ID as the published extension.");
console.log("Set the same client ID as GOOGLE_CLIENT_ID on the server, then reload the extension at chrome://extensions.");
