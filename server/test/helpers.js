// Test harness: a real app instance on a real Postgres engine, with a
// controllable clock.
//
// By default each app gets a fresh in-memory PGlite database. Set
// TEST_DATABASE_URL (an admin connection to a Postgres server) to run the
// same suite against real Postgres: each app then gets its own database.

import { randomBytes } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDb, migrate } from "../src/db/index.js";
import { buildApp } from "../src/app.js";

export const ADMIN_TOKEN = "test-admin-token-0123456789abcdef";
export const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

let ipCounter = 0;
export const nextIp = () => `203.0.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
export const newInstallId = () => randomBytes(24).toString("base64url");

async function freshDatabaseUrl() {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) return { url: "", drop: async () => {} };
  const { default: pg } = await import("pg");
  const name = `xaicg_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

export async function createTestApp(env = {}) {
  const database = await freshDatabaseUrl();
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: database.url,
    APP_SECRET: "test-secret-test-secret-test-secret",
    ADMIN_TOKEN,
    CLIENT_IP_HEADER: "x-real-ip",
    RL_IP_PER_MIN: "100000",
    REGISTER_PER_IP_PER_HOUR: "1000",
    DEVICES_PER_IP_PER_DAY: "1000",
    RL_DRAFTS_PER_DEVICE_PER_MIN: "1000",
    ...env,
  });

  let offset = 0;
  const clock = () => Date.now() + offset;
  const db = await createDb(config, null);
  await migrate(db, null);
  const app = await buildApp({ config, db, clock });
  await app.ready();

  const call = async (method, url, { token, body, ip, headers = {} } = {}) => {
    const res = await app.inject({
      method,
      url,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(ip ? { "x-real-ip": ip } : {}),
        ...headers,
      },
      ...(body !== undefined ? { payload: body } : {}),
    });
    let parsed = null;
    try {
      parsed = res.json();
    } catch {
      /* not JSON */
    }
    return { status: res.statusCode, body: parsed, headers: res.headers, raw: res.body };
  };

  const t = {
    app,
    db,
    config,
    advance: (ms) => {
      offset += ms;
    },
    call,
    // Register a new install. Returns { token, deviceId, created, ip, installId }.
    async install({ ip = nextIp(), installId = newInstallId(), headers } = {}) {
      const res = await call("POST", "/v1/devices", { body: { installId }, ip, headers });
      if (res.status !== 200) throw new Error(`install failed: ${res.status} ${res.raw}`);
      return { ...res.body, ip, installId };
    },
    // Report one draft of this kind.
    draft: (device, kind = "reply", extra = {}) => call("POST", "/v1/usage", { token: device.token, ip: device.ip, body: { kind }, ...extra }),
    stats: () => call("GET", "/admin/api/stats", { token: ADMIN_TOKEN, ip: "198.51.100.7" }),
    async close() {
      await app.close();
      await db.close();
      await database.drop();
    },
  };
  return t;
}
