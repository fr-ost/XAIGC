#!/usr/bin/env node
// Package the extension for the Chrome Web Store.
//
//   node scripts/pack-extension.mjs
//
// Writes dist/xaicg-extension-<version>.zip, the file you upload in the
// developer dashboard. It refuses to package a build that still points at
// localhost, because that build would install fine and then fail for every
// user. (Pass --allow-local to package one anyway, for your own testing.)
//
// No dependencies: the zip is written here, so this works the same on
// Windows, macOS and Linux.

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "extension");
const allowLocal = process.argv.includes("--allow-local");

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

// ---- checks ------------------------------------------------------------------

const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
const config = await readFile(path.join(source, "config.js"), "utf8");
const apiBase = /export const API_BASE = "([^"]*)";/.exec(config)?.[1];
if (!apiBase) fail("Could not find API_BASE in extension/config.js.");

const api = new URL(apiBase);
const local = ["localhost", "127.0.0.1"].includes(api.hostname);
if (local && !allowLocal) {
  fail(
    `The extension still points at ${apiBase}.\n` +
      "Point it at your deployed server first:\n" +
      "  node scripts/set-api-url.mjs https://your-server.example",
  );
}
if (!manifest.host_permissions?.includes(`${api.origin}/*`)) {
  fail(
    `manifest.json has no host permission for ${api.origin}, so the extension could not reach its server.\n` +
      `Run:  node scripts/set-api-url.mjs ${api.origin}`,
  );
}

// Without a real Google client the extension cannot sign anyone in.
const googleClient = manifest.oauth2?.client_id || "";
const signInReady = /\.apps\.googleusercontent\.com$/.test(googleClient) && !googleClient.startsWith("REPLACE_");

// The store assigns the extension its ID, and rejects a manifest that brings
// its own "key". The key is only there so an unpacked copy gets the same ID.
const packedManifest = { ...manifest };
delete packedManifest.key;
const packedManifestBytes = Buffer.from(JSON.stringify(packedManifest, null, 2) + "\n");

// ---- collect files -------------------------------------------------------------

async function walk(dir, prefix = "") {
  const found = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue; // .DS_Store and friends
    const name = prefix + entry.name;
    if (entry.isDirectory()) found.push(...(await walk(path.join(dir, entry.name), `${name}/`)));
    else if (entry.isFile()) found.push(name);
  }
  return found;
}
const names = await walk(source);
if (!names.includes("manifest.json")) fail("extension/manifest.json is missing.");

// ---- write the zip ----------------------------------------------------------------

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// One fixed timestamp, so the same source always produces the same file.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const parts = [];
const directory = [];
let offset = 0;
for (const name of names) {
  const data = name === "manifest.json" ? packedManifestBytes : await readFile(path.join(source, name));
  const packed = deflateRawSync(data, { level: 9 });
  const nameBytes = Buffer.from(name, "utf8");
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // names are UTF-8
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  parts.push(local, nameBytes, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(offset, 42);
  directory.push(central, nameBytes);

  offset += local.length + nameBytes.length + packed.length;
}

const directorySize = directory.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(names.length, 8);
end.writeUInt16LE(names.length, 10);
end.writeUInt32LE(directorySize, 12);
end.writeUInt32LE(offset, 16);

const out = path.join(root, "dist", `xaicg-extension-${manifest.version}.zip`);
await mkdir(path.dirname(out), { recursive: true });
const zip = Buffer.concat([...parts, ...directory, end]);
await writeFile(out, zip);

console.log(`Packaged XAICG ${manifest.version} for ${api.origin}`);
console.log(`  ${path.relative(root, out)}  (${names.length} files, ${Math.round(zip.length / 1024)} KB)`);
if (local) console.log("  Note: this build talks to localhost. Do not upload it to the store.");
if (!signInReady) {
  console.log("  Note: Google sign-in is not set up in this build, so nobody can sign in with it.");
  console.log("        Run:  node scripts/set-google-client.mjs <client-id>   (SETUP.md, Part 3)");
}
