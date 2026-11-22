#!/usr/bin/env node
// Package the extension for the Chrome Web Store.
//
//   node scripts/pack-extension.mjs
//
// Writes dist/xaicg-extension-<version>.zip, the file you upload in the
// developer dashboard. --out <dir> also writes an unpacked copy there;
// --no-zip skips the zip.
//
// It refuses to package a build that still points its counter at
// localhost, because that build would install fine and then report to
// nowhere for every user. (Pass --allow-local to package one anyway, for
// your own testing.)
//
// No dependencies: the zip is written here, so this works the same on
// Windows, macOS and Linux.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

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

const packedManifest = { ...manifest };

// The store assigns the extension its ID, and rejects a manifest that brings
// its own "key". The key is only there so an unpacked copy gets the same ID.
delete packedManifest.key;
files.set("manifest.json", Buffer.from(JSON.stringify(packedManifest, null, 2) + "\n"));

const names = [...files.keys()].sort((a, b) => a.localeCompare(b));

// ---- an unpacked copy ------------------------------------------------------------

const slug = "xaicg-extension";
if (option("--out")) {
  const outDir = path.resolve(option("--out"));
  if (outDir === source || outDir === root) fail("--out must not be the extension folder or the repository itself.");
  await rm(outDir, { recursive: true, force: true });
  for (const name of names) {
    const target = path.join(outDir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, files.get(name));
  }
  console.log(`Unpacked XAICG ${manifest.version}: ${path.relative(root, outDir) || outDir}  (load it at chrome://extensions)`);
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

  console.log(`Packaged XAICG ${manifest.version} (counts go to ${api.origin})`);
  console.log(`  ${path.relative(root, out)}  (${names.length} files, ${Math.round(zip.length / 1024)} KB)`);
}

if (local) console.log("  Note: this build reports to localhost. Do not upload it to the store.");
