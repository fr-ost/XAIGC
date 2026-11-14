#!/usr/bin/env node
// Give the extension its Google sign-in client.
//
//   node scripts/set-google-client.mjs 1234-abc.apps.googleusercontent.com
//   node scripts/set-google-client.mjs 1234-abc.apps.googleusercontent.com --key "MIIBIjANBg..."
//
// The client ID comes from Google Cloud: an OAuth client of type "Chrome
// Extension", created for this extension's ID (see SETUP.md, Part 3). Set
// the same value as GOOGLE_CLIENT_ID on the server.
//
// --key is optional. It is the extension's public key from the Chrome Web
// Store dashboard (Package, View public key). With it in the manifest, a copy
// loaded unpacked gets the same ID as the published extension, so Google
// sign-in works while you test. It is left out of the zip you upload.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const manifestPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "extension", "manifest.json");
const args = process.argv.slice(2);
const keyAt = args.indexOf("--key");
const key = keyAt >= 0 ? (args[keyAt + 1] || "").replace(/\s+/g, "") : null;
const clientId = args.filter((_, i) => keyAt < 0 || (i !== keyAt && i !== keyAt + 1))[0] || "";

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
if (keyAt >= 0 && !/^[A-Za-z0-9+/]{100,}={0,2}$/.test(key)) {
  fail("--key should be the public key from the store dashboard: one long line of letters and digits, without the BEGIN/END lines.");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!manifest.permissions.includes("identity")) manifest.permissions.push("identity");
manifest.oauth2 = { client_id: clientId, scopes: ["openid", "email", "profile"] };
if (key) manifest.key = key;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Google sign-in client set to ${clientId}`);
if (key) console.log("Public key added: an unpacked copy now has the same ID as the published extension.");
console.log("Set the same client ID as GOOGLE_CLIENT_ID on the server, then reload the extension at chrome://extensions.");
