// Test harness: a real app instance on a real Postgres engine, with OpenAI
// replaced by an in-process fake and a controllable clock.
//
// By default each app gets a fresh in-memory PGlite database. Set
// TEST_DATABASE_URL (an admin connection to a Postgres server) to run the
// same suite against real Postgres: each app then gets its own database.

import { randomBytes } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDb, migrate } from "../src/db/index.js";
import { createOpenAI } from "../src/engine/openai.js";
import { createEngine } from "../src/engine/index.js";
import { buildApp } from "../src/app.js";

export const ADMIN_TOKEN = "test-admin-token-0123456789abcdef";
export const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

const DEFAULT_CANDIDATES = [
  "Fees dropping that much only matters if the bridge stays up during a busy week.",
  "Honestly the rollout timing makes me doubt the whole plan a little.",
  "Nobody mentions how small accounts get squeezed once bigger players pile in early.",
];

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export function chatResponse(payload, usage = { prompt_tokens: 420, completion_tokens: 90 }) {
  return json(200, {
    id: "chatcmpl-test",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: typeof payload === "string" ? payload : JSON.stringify(payload) } }],
    usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
  });
}

export const openaiError = (status, message, extra = {}) => json(status, { error: { message, type: "invalid_request_error", ...extra } });

// Fake OpenAI. Override behavior per test with fake.chat = (body) => Response.
export function createFakeOpenAI() {
  const fake = {
    calls: [],
    chatCalls: () => fake.calls.filter((c) => c.path === "/chat/completions"),
    chat: (body) => {
      const isThread = body.response_format?.json_schema?.name === "thread";
      return chatResponse(
        isThread
          ? { tweets: ["Most launch plans fail on the boring part.", "Distribution beats features for the first year.", "Pick one channel and stay there until it works."] }
          : { candidates: DEFAULT_CANDIDATES },
      );
    },
    moderation: (body) => json(200, { results: body.input.map(() => ({ flagged: false })) }),
    model: () => json(200, { id: "test-model", object: "model" }),
    fetch: async (url, init = {}) => {
      const path = new URL(url).pathname.replace(/^\/v1/, "");
      const body = init.body ? JSON.parse(init.body) : null;
      fake.calls.push({ path, body, headers: init.headers });
      if (path === "/chat/completions") return fake.chat(body, init);
      if (path === "/moderations") return fake.moderation(body);
      if (path.startsWith("/models/")) return fake.model(path);
      return json(404, { error: { message: "not found" } });
    },
  };
  return fake;
}

let ipCounter = 0;
export const nextIp = () => `203.0.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
export const newInstallId = () => randomBytes(24).toString("base64url");
export const xh = (handle) => Buffer.from(handle.padEnd(32, "0")).toString("hex").slice(0, 64);

async function freshDatabaseUrl() {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) return { url: "", drop: async () => {} };
  const { default: pg } = await import("pg");
  const name = `xaigc_test_${randomBytes(6).toString("hex")}`;
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
    OPENAI_API_KEY: "sk-test",
    OPENAI_MODEL: "gpt-4.1-mini",
    APP_SECRET: "test-secret-test-secret-test-secret",
    ADMIN_TOKEN,
    CLIENT_IP_HEADER: "x-real-ip",
    TRIAL_GENERATIONS: "3",
    TRIAL_IP_LIMIT: "5",
    COOLDOWN_MS: "0",
    RL_DEVICE_PER_MIN: "1000",
    RL_IP_PER_MIN: "100000",
    REGISTER_PER_IP_PER_HOUR: "1000",
    DEVICES_PER_IP_PER_DAY: "1000",
    ...env,
  });

  let offset = 0;
  const clock = () => Date.now() + offset;
  const fake = createFakeOpenAI();
  const db = await createDb(config, null);
  await migrate(db, null);
  const openai = createOpenAI(config, { fetchImpl: fake.fetch });
  const engine = createEngine(config, { openai, rng: () => 0.42 });
  const app = await buildApp({ config, db, engine, clock });
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
    fake,
    openai,
    advance: (ms) => {
      offset += ms;
    },
    call,
    // Register a new install. Returns { token, deviceId, account, ip, installId }.
    async install({ ip = nextIp(), installId = newInstallId() } = {}) {
      const res = await call("POST", "/v1/devices", { body: { installId }, ip });
      if (res.status !== 200) throw new Error(`install failed: ${res.status} ${res.raw}`);
      return { ...res.body, ip, installId };
    },
    generate: (device, body = {}, extra = {}) =>
      call("POST", "/v1/generate", {
        token: device.token,
        ip: device.ip,
        body: { kind: "reply", post: { author: "someone", text: "We just cut bridge fees by 80% for every user starting Monday." }, ...body },
        ...extra,
      }),
    me: (device) => call("GET", "/v1/me", { token: device.token, ip: device.ip }),
    activate: (device, key, extra = {}) => call("POST", "/v1/license/activate", { token: device.token, ip: device.ip, body: { key, ...extra } }),
    deactivate: (device) => call("POST", "/v1/license/deactivate", { token: device.token, ip: device.ip }),
    admin: (method, path, body) => call(method, `/admin/api${path}`, { token: ADMIN_TOKEN, body, ip: "198.51.100.7" }),
    async license(input = {}) {
      const res = await t.admin("POST", "/licenses", { plan: "pro", ...input });
      if (res.status !== 200) throw new Error(`license create failed: ${res.status} ${res.raw}`);
      return res.body.licenses[0];
    },
    async close() {
      await app.close();
      await db.close();
      await database.drop();
    },
  };
  return t;
}
