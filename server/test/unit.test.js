import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config.js";
import { connectionStringFor, waitForDatabase } from "../src/db/index.js";
import { ipGroup, safeEqual } from "../src/services/crypto.js";
import { createActivityGate, createLimiter } from "../src/services/ratelimit.js";

/* --------------------------------- config --------------------------------- */

test("config: settings from versions that wrote drafts on the server are named at boot", () => {
  assert.deepEqual(loadConfig({}).notices, []);
  const old = loadConfig({ OPENAI_API_KEY: "sk-x", GOOGLE_CLIENT_ID: "x.apps.googleusercontent.com", PLANS_JSON: "{}" });
  assert.equal(old.notices.length, 3);
  assert.match(old.notices[0], /OPENAI_API_KEY is no longer used/);
  assert.equal(loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://x", APP_SECRET: "x".repeat(32) }).production, true, "no OpenAI key needed any more");
});

test("config: production refuses to boot without its secrets", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), (err) => {
    assert.equal(err.code, "CONFIG_INVALID");
    assert.match(err.message, /DATABASE_URL/);
    assert.doesNotMatch(err.message, /OPENAI/, "no model key: drafts are written on users' computers");
    assert.match(err.message, /APP_SECRET/);
    return true;
  });
});

test("config: rejects a short admin token and malformed origins", () => {
  assert.throws(() => loadConfig({ ADMIN_TOKEN: "short" }), /ADMIN_TOKEN/);
  assert.throws(() => loadConfig({ ALLOWED_ORIGINS: "abcdef" }), /ALLOWED_ORIGINS/);
  const ok = loadConfig({ ALLOWED_ORIGINS: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" });
  assert.equal(ok.allowedOrigins.length, 1);
});

test("config: X-Real-IP is trusted by default only on Railway", () => {
  const base = { NODE_ENV: "production", DATABASE_URL: "postgres://x", OPENAI_API_KEY: "k", APP_SECRET: "s".repeat(32) };
  const railway = { ...base, RAILWAY_ENVIRONMENT_NAME: "production" };
  assert.equal(loadConfig(railway).clientIpHeader, "x-real-ip");
  assert.equal(loadConfig({ ...railway, CLIENT_IP_HEADER: "none" }).clientIpHeader, "");
  // On an unknown host nothing is assumed: a header the platform does not
  // overwrite could be forged by the client.
  assert.equal(loadConfig(base).clientIpHeader, "");
  assert.equal(loadConfig({ ...base, CLIENT_IP_HEADER: "CF-Connecting-IP" }).clientIpHeader, "cf-connecting-ip");
  assert.equal(loadConfig({}).clientIpHeader, "");
});

test("database TLS: an explicit setting is not overridden by ?sslmode= in the URL", () => {
  const url = "postgres://u:p@db.example.com:5432/postgres?sslmode=no-verify&application_name=xaicg";
  const plain = loadConfig({ DATABASE_URL: url });
  assert.equal(connectionStringFor(plain), url, "left alone when nothing is configured explicitly");
  for (const env of [{ DATABASE_SSL: "true" }, { DATABASE_SSL_CA: "-----BEGIN CERTIFICATE-----\\nx\\n-----END CERTIFICATE-----" }, { DATABASE_SSL: "no-verify" }]) {
    const cleaned = new URL(connectionStringFor(loadConfig({ DATABASE_URL: url, ...env })));
    assert.equal(cleaned.searchParams.get("sslmode"), null, JSON.stringify(env));
    assert.equal(cleaned.searchParams.get("application_name"), "xaicg", "other parameters are kept");
    assert.equal(cleaned.host, "db.example.com:5432");
  }
});

test("boot waits for a database that is still starting, but not for wrong settings", async () => {
  const failing = (errors) => {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      query: async () => {
        const err = errors[calls++];
        if (err) throw err;
        return { rows: [] };
      },
    };
  };
  const code = (c) => Object.assign(new Error(c), { code: c });
  const sleeps = [];
  const sleep = async (ms) => void sleeps.push(ms);

  // Refused, then DNS not ready, then "starting up", then fine.
  const starting = failing([code("ECONNREFUSED"), code("ENOTFOUND"), code("57P03")]);
  assert.equal(await waitForDatabase(starting, { sleep, delayMs: 5 }), 4);
  assert.deepEqual(sleeps, [5, 5, 5]);

  // Node reports a dual-stack connection failure as an AggregateError.
  const dual = failing([Object.assign(new Error("all failed"), { errors: [code("ECONNREFUSED"), code("ENETUNREACH")] })]);
  assert.equal(await waitForDatabase(dual, { sleep }), 2);
  const slow = failing([new Error("timeout exceeded when trying to connect")]);
  assert.equal(await waitForDatabase(slow, { sleep }), 2);

  // A wrong password is a settings problem: fail immediately, with that error.
  const wrongPassword = failing([code("28P01"), null]);
  await assert.rejects(() => waitForDatabase(wrongPassword, { sleep }), (err) => err.code === "28P01");
  assert.equal(wrongPassword.calls, 1);
  const noDatabase = failing([code("3D000")]);
  await assert.rejects(() => waitForDatabase(noDatabase, { sleep }), (err) => err.code === "3D000");

  // It does give up eventually, with the last real error.
  const never = failing(Array(10).fill(code("ECONNREFUSED")));
  await assert.rejects(() => waitForDatabase(never, { sleep, attempts: 3 }), (err) => err.code === "ECONNREFUSED");
  assert.equal(never.calls, 3);
});

test("ipGroup: IPv4 is kept whole, IPv6 collapses to its /64", () => {
  assert.equal(ipGroup("203.0.113.9"), "203.0.113.9");
  assert.equal(ipGroup("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(ipGroup("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
  assert.equal(ipGroup("2001:db8:1:2::1"), ipGroup("2001:db8:1:2:ffff:ffff:ffff:ffff"));
  assert.notEqual(ipGroup("2001:db8:1:2::1"), ipGroup("2001:db8:1:3::1"));
  assert.equal(ipGroup("2001:0db8::1"), "2001:db8:0:0::/64");
  assert.equal(ipGroup("::1"), "0:0:0:0::/64");
  assert.equal(ipGroup(""), "unknown");
});

test("safeEqual compares without leaking length", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", "abc"), false);
});

test("limiter: allows the burst, then refills over the window", () => {
  let now = 0;
  const limiter = createLimiter({ limit: 3, windowMs: 3000, now: () => now });
  assert.equal(limiter.take("a").ok, true);
  assert.equal(limiter.take("a").ok, true);
  assert.equal(limiter.take("a").ok, true);
  const denied = limiter.take("a");
  assert.equal(denied.ok, false);
  assert.ok(denied.retryAfterMs > 0 && denied.retryAfterMs <= 1000);
  assert.equal(limiter.take("b").ok, true, "keys are independent");
  now += 1000;
  assert.equal(limiter.take("a").ok, true, "one token back after a third of the window");
  assert.equal(limiter.take("a").ok, false);
});

test("limiter: check does not consume, sweep drops refilled keys", () => {
  let now = 0;
  const limiter = createLimiter({ limit: 1, windowMs: 1000, now: () => now });
  assert.equal(limiter.check("a").ok, true);
  assert.equal(limiter.check("a").ok, true);
  limiter.take("a");
  assert.equal(limiter.check("a").ok, false);
  assert.equal(limiter.size, 1);
  now += 1000;
  limiter.sweep();
  assert.equal(limiter.size, 0);
});

test("activity gate: one at a time, then a cooldown", () => {
  let now = 0;
  const gate = createActivityGate({ cooldownMs: 2000, now: () => now });
  assert.equal(gate.enter("d").ok, true);
  assert.equal(gate.enter("d").code, "busy");
  gate.leave("d");
  const cooling = gate.enter("d");
  assert.equal(cooling.code, "cooldown");
  assert.equal(cooling.retryAfterMs, 2000);
  now += 2000;
  assert.equal(gate.enter("d").ok, true);
  gate.leave("d", { countCooldown: false });
  assert.equal(gate.enter("d").ok, true, "a failed attempt does not start a cooldown");
  gate.leave("d");
  assert.equal(gate.enter("d").code, "cooldown");
});
