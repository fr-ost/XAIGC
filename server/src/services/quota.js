// Quota accounting.
//
// A generation is reserved (counted) BEFORE the model is called and refunded
// if the call fails, so two parallel requests can never both slip under a
// limit. Every counter is bumped with a single conditional upsert, and all
// counters for one request move inside one transaction: either every limit
// had room, or nothing was counted.

import { num } from "../db/index.js";
import { licenseState, planFor } from "./licenses.js";

const EPOCH = "1970-01-01T00:00:00.000Z";

export function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function nextUtcMidnight(now = Date.now()) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

// What is this device allowed to do right now?
export function resolveEntitlement(config, license, now = Date.now()) {
  const state = licenseState(license, now);
  if (state === "active") {
    const plan = planFor(config, license);
    return { mode: "license", license, plan, dailyLimit: plan.dailyLimit, licenseState: state };
  }
  return { mode: "trial", licenseState: state };
}

// The trial is one allowance counted against every identity we have for the
// caller: the install, the Google account, the X account and the network.
// Whichever runs out first ends it. The order is fixed (see reserve()).
function trialKeys(config, { deviceId, userKey = null, ipHash, xhHash, now }) {
  const ipCutoff = new Date(now - config.trial.ipWindowDays * 86_400_000).toISOString();
  const keys = [{ key: `dev:${deviceId}`, limit: config.trial.generations, cutoff: EPOCH, type: "device" }];
  if (userKey) keys.push({ key: `user:${userKey}`, limit: config.trial.generations, cutoff: EPOCH, type: "user" });
  if (xhHash) keys.push({ key: `xh:${xhHash}`, limit: config.trial.generations, cutoff: EPOCH, type: "account" });
  if (ipHash) keys.push({ key: `ip:${ipHash}`, limit: config.trial.ipLimit, cutoff: ipCutoff, type: "network" });
  return keys;
}

async function bumpDaily(q, subject, day, limit) {
  if (limit <= 0) return false;
  const { rows } = await q.query(
    `INSERT INTO usage_daily (subject, day, count) VALUES ($1, $2, 1)
     ON CONFLICT (subject, day) DO UPDATE SET count = usage_daily.count + 1
     WHERE usage_daily.count < $3
     RETURNING count`,
    [subject, day, limit],
  );
  return rows.length > 0;
}

// Windowed counter: rows older than `cutoff` start over, otherwise the bump
// only succeeds while `used` is under `limit`.
async function bumpTrial(q, { key, limit, cutoff }) {
  if (limit <= 0) return false;
  const { rows } = await q.query(
    `INSERT INTO trial_counters (key, used) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET
       used = CASE WHEN trial_counters.window_start < $3::timestamptz THEN 1 ELSE trial_counters.used + 1 END,
       window_start = CASE WHEN trial_counters.window_start < $3::timestamptz THEN now() ELSE trial_counters.window_start END,
       updated_at = now()
     WHERE trial_counters.window_start < $3::timestamptz OR trial_counters.used < $2
     RETURNING used`,
    [key, limit, cutoff],
  );
  return rows.length > 0;
}

class Denied extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

// Returns { ok: false, reason } or { ok: true, refund(), addTokens(in, out) }.
// reason: daily_limit | trial_exhausted | trial_network_exhausted |
//         trial_capacity | capacity
//
// Lock order matters. Every writer touches counter rows one at a time and in
// the same order (trial keys, then the plan/trial daily row, then 'global'),
// so two requests can never hold each other's rows and deadlock.
export async function reserve(db, config, { device, entitlement, ipHash, xhHash, now = Date.now() }) {
  const day = utcDay(now);
  const licensed = entitlement.mode === "license";
  const trial = licensed ? [] : trialKeys(config, { deviceId: device.id, userKey: device.user?.trial_key, ipHash, xhHash, now });
  const daily = licensed
    ? [{ subject: `lic:${entitlement.license.id}`, limit: entitlement.dailyLimit, reason: "daily_limit" }]
    : [{ subject: "global:trial", limit: config.caps.trialGlobalDaily, reason: "trial_capacity" }];
  daily.push({ subject: "global", limit: config.caps.globalDaily, reason: "capacity" });

  try {
    await db.tx(async (t) => {
      for (const k of trial) {
        if (!(await bumpTrial(t, k))) throw new Denied(k.type === "network" ? "trial_network_exhausted" : "trial_exhausted");
      }
      for (const d of daily) {
        if (!(await bumpDaily(t, d.subject, day, d.limit))) throw new Denied(d.reason);
      }
    });
  } catch (err) {
    if (err instanceof Denied) return { ok: false, reason: err.reason };
    throw err;
  }

  return {
    ok: true,
    day,
    async refund() {
      await db.tx(async (t) => {
        for (const k of trial) {
          await t.query("UPDATE trial_counters SET used = GREATEST(used - 1, 0) WHERE key = $1", [k.key]);
        }
        for (const d of daily) {
          await t.query("UPDATE usage_daily SET count = GREATEST(count - 1, 0) WHERE subject = $1 AND day = $2", [d.subject, day]);
        }
      });
    },
    // One row per statement, each in its own implicit transaction: no two
    // row locks are ever held together.
    async addTokens(tokensIn, tokensOut) {
      const tin = Math.max(0, Math.floor(Number(tokensIn) || 0));
      const tout = Math.max(0, Math.floor(Number(tokensOut) || 0));
      if (!tin && !tout) return;
      for (const d of daily) {
        await db.query(
          "UPDATE usage_daily SET tokens_in = tokens_in + $3, tokens_out = tokens_out + $4 WHERE subject = $1 AND day = $2",
          [d.subject, day, tin, tout],
        );
      }
    },
  };
}

// Read-only view of the trial allowance. `remaining` is the tightest of the
// device, X-account and network counters.
export async function trialStatus(db, config, { deviceId, userKey = null, ipHash, xhHash, now = Date.now() }) {
  const keys = trialKeys(config, { deviceId, userKey, ipHash, xhHash, now });
  const { rows } = await db.query("SELECT key, used, window_start FROM trial_counters WHERE key = ANY($1::text[])", [
    keys.map((k) => k.key),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  let remaining = config.trial.generations;
  let limitedBy = "device";
  for (const k of keys) {
    const row = byKey.get(k.key);
    const expired = row && new Date(row.window_start).getTime() < new Date(k.cutoff).getTime();
    const used = row && !expired ? num(row.used) : 0;
    const left = Math.max(0, k.limit - used);
    if (left < remaining) {
      remaining = left;
      limitedBy = k.type;
    }
  }
  const limit = config.trial.generations;
  return { limit, used: Math.max(0, limit - remaining), remaining, limitedBy };
}

export async function licenseUsageToday(db, licenseId, day) {
  const { rows } = await db.query("SELECT count FROM usage_daily WHERE subject = $1 AND day = $2", [`lic:${licenseId}`, day]);
  return rows[0] ? num(rows[0].count) : 0;
}

// The account object returned by /v1/me and alongside every generation. The
// extension renders plan, remaining quota and license state from this alone.
//   user            who is signed in on this browser, or null
//   auth.google     whether this server offers Google sign-in
//   auth.signInRequired  true when this browser must sign in before it can generate
//   accountLicense  a license belonging to the signed-in account that is not
//                   on this browser (`waiting` from the license service):
//                   reason "available" (a seat is free), "device_limit"
//                   (seats taken, can be moved here) or "detached" (the user
//                   removed it here)
export async function buildAccount(db, config, { device, ipHash, xhHash = null, now = Date.now(), waiting = null }) {
  const license = device.license || null;
  const entitlement = resolveEntitlement(config, license, now);
  let accountLicense = null;
  if (waiting?.license) {
    const plan = planFor(config, waiting.license);
    accountLicense = {
      hint: waiting.license.key_hint,
      plan: plan.label,
      maxDevices: plan.maxDevices,
      devicesUsed: waiting.devicesUsed ?? plan.maxDevices,
      reason: waiting.reason,
    };
  }
  const base = {
    links: config.links,
    minClientVersion: config.minClientVersion || null,
    cooldownMs: config.limits.cooldownMs,
    user: device.user ? { email: device.user.email, name: device.user.name || null } : null,
    auth: {
      google: config.google.enabled,
      signInRequired: entitlement.mode === "trial" && config.trial.requireSignIn && !device.user,
    },
    accountLicense,
  };

  let licenseInfo = null;
  if (license) {
    const plan = planFor(config, license);
    const used = await db.query("SELECT count(*)::int AS n FROM devices WHERE license_id = $1", [license.id]);
    licenseInfo = {
      hint: license.key_hint,
      state: entitlement.licenseState,
      plan: plan.label,
      expiresAt: license.expires_at ? new Date(license.expires_at).toISOString() : null,
      devicesUsed: num(used.rows[0].n),
      maxDevices: plan.maxDevices,
    };
  }

  if (entitlement.mode === "license") {
    const used = await licenseUsageToday(db, license.id, utcDay(now));
    const limit = entitlement.dailyLimit;
    return {
      ...base,
      plan: entitlement.plan.id,
      planLabel: entitlement.plan.label,
      licensed: true,
      license: licenseInfo,
      quota: { scope: "day", limit, used: Math.min(used, limit), remaining: Math.max(0, limit - used), resetsAt: nextUtcMidnight(now) },
      notice: null,
    };
  }

  const trial = await trialStatus(db, config, { deviceId: device.id, userKey: device.user?.trial_key, ipHash, xhHash: xhHash || device.xh_hash, now });
  return {
    ...base,
    plan: "trial",
    planLabel: "Free trial",
    licensed: false,
    license: licenseInfo,
    quota: { scope: "trial", limit: trial.limit, used: trial.used, remaining: trial.remaining, resetsAt: null, limitedBy: trial.limitedBy },
    notice: entitlement.licenseState === "expired" ? "license_expired" : entitlement.licenseState === "revoked" ? "license_revoked" : null,
  };
}
