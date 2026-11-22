// XAICG server configuration.
//
// The server only counts: how many installs there are, and how many drafts
// of each kind they wrote. Drafts are written on each user's own computer by
// Chrome's built-in AI, so there is no model, no API key and no account here.
// Every tunable is read from environment variables, so the same build runs
// locally, in tests and on Railway.

import { readFileSync } from "node:fs";

// The version lives in package.json (set it with scripts/set-version.mjs).
export const SERVER_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

function int(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function list(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTrustProxy(value) {
  if (value === undefined || value === "") return false;
  if (/^(true|false)$/i.test(value)) return /^true$/i.test(value);
  const n = Number(value);
  if (Number.isInteger(n) && n >= 0) return n;
  return value; // comma separated CIDR list, passed through to Fastify
}

// Settings from versions that wrote drafts on the server and sold plans.
// They do nothing now; the server says so at boot rather than ignore them silently.
const RETIRED = [
  "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "GOOGLE_CLIENT_ID", "PLANS_JSON", "FREE_DAILY_LIMIT", "FREE_IP_DAILY_LIMIT",
  "FREE_REQUIRE_SIGN_IN", "FREE_GLOBAL_DAILY_CAP", "GLOBAL_DAILY_CAP", "TRIAL_GENERATIONS", "BUY_URL", "MODERATION",
];

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  // Railway injects RAILWAY_* variables into every service.
  const onRailway = Object.keys(env).some((key) => key.startsWith("RAILWAY_"));

  const config = {
    version: SERVER_VERSION,
    production,
    port: int(env.PORT, 8787, { min: 1, max: 65535 }),
    host: env.HOST || "0.0.0.0",
    logLevel: env.LOG_LEVEL || (env.NODE_ENV === "test" ? "silent" : "info"),
    // Which header carries the caller's address is a property of the host.
    // Railway's edge sets X-Real-IP on every public request, so that is the
    // default there. Anywhere else nothing is assumed: a header the platform
    // does not overwrite could be forged by the client. Set CLIENT_IP_HEADER
    // explicitly, or "none" to use the socket address.
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    clientIpHeader: (env.CLIENT_IP_HEADER ?? (production && onRailway ? "x-real-ip" : "")).toLowerCase().replace(/^none$/, ""),
    onRailway,

    databaseUrl: env.DATABASE_URL || "",
    databaseSsl: (env.DATABASE_SSL || "").toLowerCase(), // "", "true", "no-verify", "false"
    // PEM text of the database's root certificate, for hosts whose
    // certificate is not signed by a public authority (Supabase publishes one).
    databaseSslCa: (env.DATABASE_SSL_CA || "").replace(/\\n/g, "\n"),
    databasePoolMax: int(env.DATABASE_POOL_MAX, 10, { min: 1, max: 100 }),
    pgliteDir: env.PGLITE_DIR || "", // empty = in-memory (dev/test only)

    // Keys the network hashes that stop one network inflating the counts.
    appSecret: env.APP_SECRET || (production ? "" : "dev-only-secret-change-me"),
    adminToken: env.ADMIN_TOKEN || "",

    limits: {
      ipPerMinute: int(env.RL_IP_PER_MIN, 120, { min: 1 }),
      // Drafts are written on the user's computer, a few seconds each. More
      // counts than this from one install in a minute are not real.
      draftsPerDevicePerMinute: int(env.RL_DRAFTS_PER_DEVICE_PER_MIN, 30, { min: 1 }),
      // And a day's worth: no person writes more. Counts past it are dropped.
      draftsPerDevicePerDay: int(env.DRAFTS_PER_DEVICE_PER_DAY, 2000, { min: 1 }),
      registerPerIpPerHour: int(env.REGISTER_PER_IP_PER_HOUR, 20, { min: 1 }),
      devicesPerIpPerDay: int(env.DEVICES_PER_IP_PER_DAY, 30, { min: 1 }),
      reregistrationsPerDay: int(env.REREGISTRATIONS_PER_DAY, 5, { min: 1 }),
      adminFailuresPer15Min: int(env.ADMIN_FAILURES_PER_15MIN, 10, { min: 1 }),
      bodyBytes: int(env.BODY_LIMIT_BYTES, 4 * 1024, { min: 1024 }),
    },

    allowedOrigins: list(env.ALLOWED_ORIGINS),
    usageEventRetentionDays: int(env.USAGE_EVENT_RETENTION_DAYS, 60, { min: 1 }),
    links: { website: "https://xaicg.uniquelabs.org" },
  };

  const problems = [];
  if (production) {
    if (!config.databaseUrl) problems.push("DATABASE_URL is required in production (add the Railway Postgres plugin).");
    if (config.appSecret.length < 24) problems.push("APP_SECRET is required in production (use 32+ random characters).");
  }
  if (config.adminToken && config.adminToken.length < 24) {
    problems.push("ADMIN_TOKEN must be at least 24 characters. Leave it unset to disable the admin dashboard.");
  }
  for (const origin of config.allowedOrigins) {
    if (!/^(chrome-extension|moz-extension|https?):\/\/[^/\s]+$/.test(origin)) {
      problems.push(`ALLOWED_ORIGINS entry "${origin}" is not a valid origin (example: chrome-extension://abcdefghijklmnopabcdefghijklmnop).`);
    }
  }
  if (problems.length) {
    const err = new Error("Invalid configuration:\n - " + problems.join("\n - "));
    err.code = "CONFIG_INVALID";
    throw err;
  }

  config.notices = RETIRED.filter((name) => env[name]).map((name) => `${name} is no longer used: drafts are written on each user's computer. You can delete it.`);
  return config;
}
