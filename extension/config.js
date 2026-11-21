// XAICG extension configuration.
//
// API_BASE is the address of your XAICG server. After deploying the server,
// run `node scripts/set-api-url.mjs https://your-server.example` from the
// repository root: it updates this file and the host permission in
// manifest.json together.

export const API_BASE = "https://aigc.uniquelabs.org";

export const CLIENT_VERSION = chrome.runtime.getManifest().version;

// "standard": every draft is written by the XAICG server.
// "unlimited": free users' drafts are written on their own computer by
// Chrome's built-in AI, with no daily limit (editions/unlimited/).
// scripts/pack-extension.mjs sets this when it builds an edition.
export const EDITION = "standard";

export const PRODUCT = {
  name: "XAICG",
  tagline: "X AI Comment/Reply Generator for Twitter",
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
  // Unlimited edition only. Where drafts are written: "auto" (this computer,
  // unless the user has a plan), "device" (always this computer) or "server".
  engine: "auto",
};
