#!/usr/bin/env node
// Package the extension for the Chrome Web Store.
//
//   node scripts/pack-extension.mjs                       the standard edition
//   node scripts/pack-extension.mjs --edition unlimited   XAICG Unlimited
//
// The standard edition is extension/ as it is, and becomes
// dist/xaicg-extension-<version>.zip.
//
// An edition is extension/ plus the files in editions/<name>/extension/,
// which replace or add to it, with the manifest changes and settings in
// editions/<name>/edition.json. XAICG Unlimited also takes the draft cleanup
// from server/src/engine/, so drafts written on a computer are tidied the
// same way as the server's. It becomes dist/xaicg-<name>-<version>.zip, and
// an unpacked copy in dist/xaicg-<name>/ to load at chrome://extensions.
//
// It refuses to package a build that still points at localhost, because
// that build would install fine and then fail for every user. (Pass
// --allow-local to package one anyway, for your own testing.) --out <dir>
// writes the unpacked copy somewhere else; --no-zip skips the zip.
//
// No dependencies: the zip is written here, so this works the same on
// Windows, macOS and Linux.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "extension");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const allowLocal = flag("--allow-local");
const editionName = option("--edition") || "standard";

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

// ---- the edition ------------------------------------------------------------

let edition = null;
if (editionName !== "standard") {
  const file = path.join(root, "editions", editionName, "edition.json");
  if (!/^[a-z0-9-]+$/.test(editionName) || !existsSync(file)) {
    const known = existsSync(path.join(root, "editions")) ? (await readdir(path.join(root, "editions"))).join(", ") : "none";
    fail(`There is no edition called "${editionName}". Editions: standard, ${known}.`);
  }
  edition = JSON.parse(await readFile(file, "utf8"));
}

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

const files = new Map(); // path inside the package -> contents
for (const name of await walk(source)) files.set(name, await readFile(path.join(source, name)));
if (!files.has("manifest.json")) fail("extension/manifest.json is missing.");

if (edition) {
  const overlay = path.join(root, "editions", editionName, edition.files || "extension");
  for (const name of await walk(overlay)) files.set(name, await readFile(path.join(overlay, name)));
  for (const name of edition.engineFiles || []) {
    files.set(`lib/engine/${name}`, await readFile(path.join(root, "server", "src", "engine", name)));
  }
  const config = files.get("config.js").toString("utf8");
  const marked = /export const EDITION = "[^"]*";/;
  if (!marked.test(config)) fail("Could not find EDITION in extension/config.js.");
  files.set("config.js", Buffer.from(config.replace(marked, `export const EDITION = "${edition.id}";`)));
}

// ---- checks ------------------------------------------------------------------

const manifest = JSON.parse(files.get("manifest.json").toString("utf8"));
const config = files.get("config.js").toString("utf8");
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

// The edition's own name, description and Google sign-in client.
const packedManifest = { ...manifest };
let ownClient = true;
if (edition) {
  for (const [key, value] of Object.entries(edition.manifest || {})) {
    packedManifest[key] = value && typeof value === "object" && !Array.isArray(value) ? { ...(manifest[key] || {}), ...value } : value;
  }
  if (edition.googleClientId) packedManifest.oauth2 = { ...manifest.oauth2, client_id: edition.googleClientId };
  else ownClient = false;
  for (const [field, limit] of [["name", 75], ["description", 132]]) {
    if ((packedManifest[field] || "").length > limit) fail(`The ${field} in editions/${editionName}/edition.json is longer than the store allows (${limit} characters).`);
  }
}

// Without a real Google client the extension cannot sign anyone in.
const googleClient = packedManifest.oauth2?.client_id || "";
const signInReady = /\.apps\.googleusercontent\.com$/.test(googleClient) && !googleClient.startsWith("REPLACE_");

// The store assigns the extension its ID, and rejects a manifest that brings
// its own "key". The key is only there so an unpacked copy gets the same ID.
delete packedManifest.key;
files.set("manifest.json", Buffer.from(JSON.stringify(packedManifest, null, 2) + "\n"));

const names = [...files.keys()].sort((a, b) => a.localeCompare(b));

// ---- an unpacked copy (editions) ------------------------------------------------

const slug = edition ? `xaicg-${edition.id}` : "xaicg-extension";
if (edition || option("--out")) {
  const outDir = path.resolve(option("--out") || path.join(root, "dist", slug));
  if (outDir === source || outDir === root) fail("--out must not be the extension folder or the repository itself.");
  await rm(outDir, { recursive: true, force: true });
  for (const name of names) {
    const target = path.join(outDir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, files.get(name));
  }
  console.log(`Unpacked ${edition?.title || "XAICG"} ${manifest.version}: ${path.relative(root, outDir) || outDir}  (load it at chrome://extensions)`);
}

// ---- write the zip ----------------------------------------------------------------

if (!flag("--no-zip")) {
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
    const data = files.get(name);
    const packed = deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // names are UTF-8
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    parts.push(header, nameBytes, packed);

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

    offset += header.length + nameBytes.length + packed.length;
  }

  const directorySize = directory.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);

  const out = path.join(root, "dist", `${slug}-${manifest.version}.zip`);
  await mkdir(path.dirname(out), { recursive: true });
  const zip = Buffer.concat([...parts, ...directory, end]);
  await writeFile(out, zip);

  console.log(`Packaged ${edition?.title || "XAICG"} ${manifest.version} for ${api.origin}`);
  console.log(`  ${path.relative(root, out)}  (${names.length} files, ${Math.round(zip.length / 1024)} KB)`);
}

if (local) console.log("  Note: this build talks to localhost. Do not upload it to the store.");
if (!signInReady) {
  console.log("  Note: Google sign-in is not set up in this build, so nobody can sign in with it.");
  console.log("        Run:  node scripts/set-google-client.mjs <client-id>   (SETUP.md, Part 3)");
} else if (!ownClient) {
  console.log(`  Note: ${edition.title} still uses the standard edition's Google sign-in client. Once it has`);
  console.log("        its own Chrome Web Store ID, give it its own client:");
  console.log(`        node scripts/set-google-client.mjs --edition ${edition.id} <client-id>   (editions/${editionName}/README.md)`);
}
