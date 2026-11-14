// XAICG extension configuration.
//
// API_BASE is the address of your XAICG server. After deploying the server,
// run `node scripts/set-api-url.mjs https://your-server.example` from the
// repository root: it updates this file and the host permission in
// manifest.json together.

export const API_BASE = "https://aigc.uniquelabs.org";

export const CLIENT_VERSION = chrome.runtime.getManifest().version;

export const PRODUCT = {
  name: "XAICG",
  tagline: "X AI Comment/Reply Generator",
  company: "Unique Labs",
  developer: "Shahriar Ahmed",
  website: "https://uniquelabs.org",
};

export const DEFAULT_SETTINGS = {
  tone: "auto",
  persona: "",
  length: "medium",
  language: "en",
  emoji: "auto",
  outputMode: "insert", // "insert" types into X's reply box, "clipboard" only copies
  showQuestionButton: true,
  sfx: true, // sound effects when a draft starts, arrives and is sent
};
