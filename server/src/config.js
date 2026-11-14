// XAICG server configuration.
// Every tunable lives here and is read from environment variables, so the
// same build runs locally, in tests and on Railway.

import { readFileSync } from "node:fs";

// The version lives in package.json (set it with scripts/set-version.mjs).
export const SERVER_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

export const DEFAULT_PLANS = {
  starter: { label: "Starter", dailyLimit: 60, maxDevices: 1 },
  pro: { label: "Pro", dailyLimit: 200, maxDevices: 2 },
  agency: { label: "Agency", dailyLimit: 600, maxDevices: 5 },
};

// USD per 1M tokens, used only for the cost estimate on the admin dashboard.
// Override with PRICE_IN_PER_M / PRICE_OUT_PER_M when you change models.
const MODEL_PRICING = {
  "gpt-6-luna": { in: 0.1, out: 0.5 },
  "gpt-6.1-terra": { in: 1.0, out: 5.0 },
  "gpt-5.6-luna": { in: 0.2, out: 1.2 },
  "gpt-5.4-mini": { in: 0.75, out: 4.5 },
  "gpt-5-mini": { in: 0.25, out: 2.0 },
  "gpt-5-nano": { in: 0.05, out: 0.4 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1": { in: 2.0, out: 8.0 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10.0 },
};

// The model is a deployment decision, not a code decision: OpenAI retires
// small models often. Set OPENAI_MODEL to the current cheap, fast model.
export const DEFAULT_MODEL = "gpt-6-luna";

function int(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function flag(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function list(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parsePlans(raw) {
  if (!raw) return DEFAULT_PLANS;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("PLANS_JSON is not valid JSON.");
  }
  const plans = {};
  for (const [id, p] of Object.entries(parsed || {})) {
    if (!/^[a-z][a-z0-9_-]{1,30}$/.test(id)) throw new Error(`PLANS_JSON: invalid plan id "${id}".`);
    const dailyLimit = int(p?.dailyLimit, NaN, { min: 1 });
    const maxDevices = int(p?.maxDevices, NaN, { min: 1 });
    if (!Number.isFinite(dailyLimit) || !Number.isFinite(maxDevices)) {
      throw new Error(`PLANS_JSON: plan "${id}" needs numeric dailyLimit and maxDevices.`);
    }
    plans[id] = { label: String(p.label || id), dailyLimit, maxDevices };
  }
  if (!Object.keys(plans).length) throw new Error("PLANS_JSON must define at least one plan.");
  return plans;
}

function parseTrustProxy(value) {
  if (value === undefined || value === "") return false;
  if (/^(true|false)$/i.test(value)) return /^true$/i.test(value);
  const n = Number(value);
  if (Number.isInteger(n) && n >= 0) return n;
  return value; // comma separated CIDR list, passed through to Fastify
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const model = env.OPENAI_MODEL || DEFAULT_MODEL;
  const pricing = MODEL_PRICING[model] || { in: 0, out: 0 };
  // The free plan: this many generations a day for each person, for nothing.
  const freeDaily = int(env.FREE_DAILY_LIMIT, 5, { min: 0, max: 10000 });
  // Railway injects RAILWAY_* variables into every service.
  const onRailway = Object.keys(env).some((key) => key.startsWith("RAILWAY_"));

  const port = int(env.PORT, 8787, { min: 1, max: 65535 });
  // One OAuth client per extension ID. Usually that is one; a second (for an
  // unpacked development copy with its own ID) can follow after a comma.
  const googleClientIds = String(env.GOOGLE_CLIENT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
  const googleEnabled = googleClientIds.length > 0;

  const config = {
    version: SERVER_VERSION,
    production,
    port,

    // Sign in with Google, inside the extension. Enabled once GOOGLE_CLIENT_ID is set.
    google: {
      enabled: googleEnabled,
      clientIds: googleClientIds,
      tokenInfoUrl: env.GOOGLE_TOKENINFO_URL || "https://oauth2.googleapis.com/tokeninfo",
      userInfoUrl: env.GOOGLE_USERINFO_URL || "https://openidconnect.googleapis.com/v1/userinfo",
    },
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

    appSecret: env.APP_SECRET || (production ? "" : "dev-only-secret-change-me"),
    adminToken: env.ADMIN_TOKEN || "",

    openai: {
      apiKey: env.OPENAI_API_KEY || "",
      baseUrl: (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
      model,
      reasoningEffort: env.OPENAI_REASONING_EFFORT || "", // empty = chosen per model family
      verifyModelOnBoot: flag(env.OPENAI_VERIFY_MODEL, production),
      timeoutMs: int(env.OPENAI_TIMEOUT_MS, 20000, { min: 500, max: 120000 }),
      // Ceiling on all model calls for one generation, retries included. Kept
      // below the extension's own timeout so a request is never charged
      // after the client has given up on it.
      totalTimeoutMs: int(env.OPENAI_TOTAL_TIMEOUT_MS, 30000, { min: 1000, max: 120000 }),
      moderation: flag(env.MODERATION, true),
      moderationModel: env.MODERATION_MODEL || "omni-moderation-latest",
      priceInPerM: Number(env.PRICE_IN_PER_M ?? pricing.in) || 0,
      priceOutPerM: Number(env.PRICE_OUT_PER_M ?? pricing.out) || 0,
    },

    plans: parsePlans(env.PLANS_JSON),

    // The free plan. Paid plans are in `plans` above.
    free: {
      // 0 switches the free plan off: only licensed users can generate.
      dailyLimit: freeDaily,
      // All free use from one network in a day is capped here, so making
      // new accounts or reinstalling on the same connection runs dry. It is
      // well above one person's allowance because homes and offices share
      // an address.
      ipDailyLimit: int(env.FREE_IP_DAILY_LIMIT, freeDaily * 10, { min: 0 }),
      requireHandle: flag(env.FREE_REQUIRE_X_ACCOUNT ?? env.TRIAL_REQUIRE_X_ACCOUNT, false),
      // With Google sign-in configured, the free plan needs an account by
      // default: one allowance per Google account is the strongest brake on
      // farming it, and it gives you a list of who your users are.
      requireSignIn: flag(env.FREE_REQUIRE_SIGN_IN ?? env.TRIAL_REQUIRE_SIGN_IN, googleEnabled),
    },

    caps: {
      // Wallet protection: hard ceilings on generations per UTC day.
      globalDaily: int(env.GLOBAL_DAILY_CAP, 30000, { min: 1 }),
      // The most free generations served in a day, across everyone.
      freeGlobalDaily: int(env.FREE_GLOBAL_DAILY_CAP ?? env.TRIAL_GLOBAL_DAILY_CAP, 3000, { min: 0 }),
    },

    limits: {
      ipPerMinute: int(env.RL_IP_PER_MIN, 90, { min: 1 }),
      devicePerMinute: int(env.RL_DEVICE_PER_MIN, 12, { min: 1 }),
      cooldownMs: int(env.COOLDOWN_MS, 1500, { min: 0, max: 600000 }),
      registerPerIpPerHour: int(env.REGISTER_PER_IP_PER_HOUR, 10, { min: 1 }),
      devicesPerIpPerDay: int(env.DEVICES_PER_IP_PER_DAY, 15, { min: 1 }),
      activateFailuresPer15Min: int(env.ACTIVATE_FAILURES_PER_15MIN, 8, { min: 1 }),
      activationsPer30Days: int(env.ACTIVATIONS_PER_30_DAYS, 10, { min: 1 }),
      reregistrationsPerDay: int(env.REREGISTRATIONS_PER_DAY, 3, { min: 1 }),
      signInStartsPer10Min: int(env.SIGN_IN_STARTS_PER_10MIN, 10, { min: 1 }),
      refundedFailuresPerHour: int(env.REFUNDED_FAILURES_PER_HOUR, 5, { min: 0 }),
      adminFailuresPer15Min: int(env.ADMIN_FAILURES_PER_15MIN, 10, { min: 1 }),
      bodyBytes: int(env.BODY_LIMIT_BYTES, 32 * 1024, { min: 1024 }),
    },

    allowedOrigins: list(env.ALLOWED_ORIGINS),
    minClientVersion: env.MIN_CLIENT_VERSION || "",
    usageEventRetentionDays: int(env.USAGE_EVENT_RETENTION_DAYS, 60, { min: 1 }),

    links: {
      buy: env.BUY_URL || "https://xaicg.uniquelabs.org/#pricing",
      support: env.SUPPORT_URL || "https://xaicg.uniquelabs.org/support",
      website: "https://uniquelabs.org",
    },
  };

  const problems = [];
  if (production) {
    if (!config.databaseUrl) problems.push("DATABASE_URL is required in production (add the Railway Postgres plugin).");
    if (!config.openai.apiKey) problems.push("OPENAI_API_KEY is required in production.");
    if (config.appSecret.length < 24) problems.push("APP_SECRET is required in production (use 32+ random characters).");
  }
  for (const id of googleClientIds) {
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) {
      problems.push(`GOOGLE_CLIENT_ID should be an OAuth client ID ending in .apps.googleusercontent.com (got "${id.slice(0, 24)}..."). Use the client of type "Chrome Extension".`);
    }
  }
  if (config.free.requireSignIn && !googleEnabled) {
    problems.push("FREE_REQUIRE_SIGN_IN is on but Google sign-in is not configured (GOOGLE_CLIENT_ID).");
  }
  // Settings from before the free plan became a daily allowance. They are
  // ignored, and saying so beats silently doing something different.
  config.notices = [];
  for (const old of ["TRIAL_GENERATIONS", "TRIAL_IP_LIMIT", "TRIAL_IP_WINDOW_DAYS"]) {
    if (env[old] !== undefined && env[old] !== "") {
      config.notices.push(`${old} is no longer used. The free plan is now a daily allowance: FREE_DAILY_LIMIT (currently ${config.free.dailyLimit} a day) and FREE_IP_DAILY_LIMIT.`);
    }
  }
  if (config.adminToken && config.adminToken.length < 24) {
    problems.push("ADMIN_TOKEN must be at least 24 characters. Leave it unset to disable the admin API.");
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
  return config;
}
