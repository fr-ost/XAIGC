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
// Pass these to createTestApp() to switch Google sign-in on.
export const GOOGLE = { GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-google-secret", PUBLIC_URL: "http://localhost:8787" };
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
    // Fake Google. A test "signs in at Google" by registering an account
    // under an authorization code; the token endpoint then issues an ID
    // token for it the way Google would. `claims` overrides let a test
    // produce a token that should be rejected.
    google: {
      codes: new Map(),
      tokenCalls: [],
      issue(code, { nonce, account, claims = {} }) {
        fake.google.codes.set(code, { nonce, account, claims });
      },
    },
    fetch: async (url, init = {}) => {
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
        const form = Object.fromEntries(new URLSearchParams(init.body));
        fake.google.tokenCalls.push(form);
        const grant = fake.google.codes.get(form.code);
        fake.google.codes.delete(form.code); // Google's codes are single use
        if (!grant || form.client_secret !== "test-google-secret") return json(400, { error: "invalid_grant", error_description: "Bad Request" });
        const payload = {
          iss: "https://accounts.google.com",
          aud: form.client_id,
          sub: grant.account.sub,
          email: grant.account.email,
          email_verified: true,
          name: grant.account.name,
          nonce: grant.nonce,
          exp: Math.floor(Date.now() / 1000) + 3600,
          ...grant.claims,
        };
        const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
        return json(200, { access_token: "ya29.fake", id_token: `${b64({ alg: "RS256" })}.${b64(payload)}.signature` });
      }
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
  const app = await buildApp({ config, db, engine, clock, fetchImpl: fake.fetch });
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
    // The three steps of a sign-in, separately, so tests can interfere.
    async startSignIn(device) {
      const res = await call("POST", "/v1/auth/google/start", { token: device.token, ip: device.ip });
      if (res.status !== 200) return { res };
      const url = new URL(res.body.url);
      return { res, url, state: url.searchParams.get("state"), nonce: url.searchParams.get("nonce") };
    },
    // What Google does after the person picks an account: send their browser
    // back to our callback with a code. Returns the completion code that the
    // browser ends up holding (or null with the error page).
    async googleReturns(flow, account, { claims, code = `code-${randomBytes(6).toString("hex")}` } = {}) {
      fake.google.issue(code, { nonce: flow.nonce, account, claims });
      const res = await call("GET", `/auth/google/callback?code=${code}&state=${encodeURIComponent(flow.state)}`, { ip: nextIp() });
      const location = res.headers.location || "";
      return { res, completion: location.startsWith("/auth/done#code=") ? location.slice("/auth/done#code=".length) : null };
    },
    completeSignIn: (device, completion) => call("POST", "/v1/auth/google/complete", { token: device.token, ip: device.ip, body: { code: completion } }),
    // The whole thing, as one honest user would do it.
    async signIn(device, account) {
      const flow = await t.startSignIn(device);
      if (!flow.state) throw new Error(`sign-in start failed: ${flow.res.status} ${flow.res.raw}`);
      const back = await t.googleReturns(flow, account);
      if (!back.completion) throw new Error(`google callback failed: ${back.res.status} ${back.res.raw.slice(0, 200)}`);
      return t.completeSignIn(device, back.completion);
    },
    signOut: (device) => call("POST", "/v1/auth/signout", { token: device.token, ip: device.ip }),
    attach: (device, body = {}) => call("POST", "/v1/license/attach", { token: device.token, ip: device.ip, body }),
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
