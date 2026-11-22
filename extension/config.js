// XAICG extension configuration.
//
// API_BASE is the address of the XAICG server, which only counts installs
// and drafts (never their text). After deploying it, run
// `node scripts/set-api-url.mjs https://your-server.example` from the
// repository root: it updates this file and the host permission in
// manifest.json together. Drafts are written on the user's own computer by
// the on-device AI and work without the server.

export const API_BASE = "https://aigc.uniquelabs.org";

export const CLIENT_VERSION = chrome.runtime.getManifest().version;

export const PRODUCT = {
  name: "XAICG",
  tagline: "X AI Comment/Reply Generator for Twitter",
  company: "Unique Labs",
  developer: "Shahriar Ahmed",
  website: "https://xaicg.uniquelabs.org",
};

export const DEFAULT_SETTINGS = {
  tone: "auto",
  persona: "",
  length: "medium",
  // "en", "es", "de", "fr", "ja", or "auto" for the post's own language.
  language: "en",
  emoji: "auto",
  outputMode: "insert", // "insert" types into X's reply box, "clipboard" only copies
  showQuestionButton: true,
  sfx: true, // sound effects when a draft starts, arrives and is sent
};
