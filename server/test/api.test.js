// The XAICG server counts installs and drafts, and shows them to the admin.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_TOKEN, createTestApp, EXT_ORIGIN, newInstallId, nextIp } from "./helpers.js";

const DAY = 86_400_000;

describe("installs", () => {
  let t;
  before(async () => (t = await createTestApp()));
  after(() => t.close());

  test("a new install registers and gets a token", async () => {
    const d = await t.install();
    assert.match(d.token, /^xd_/);
    assert.equal(d.created, true);
    assert.match(d.deviceId, /^[0-9a-f-]{36}$/);
  });

  test("the install id is validated", async () => {
    for (const body of [{ installId: "short" }, { installId: "has spaces and symbols !!!!!!!!!!!" }, {}]) {
      assert.equal((await t.call("POST", "/v1/devices", { body })).status, 400);
    }
  });

  test("registering the same install again keeps one install and rotates the token", async () => {
    const first = await t.install();
    const again = await t.install({ installId: first.installId, ip: first.ip });
    assert.equal(again.deviceId, first.deviceId);
    assert.equal(again.created, false);
    assert.notEqual(again.token, first.token);
    assert.equal((await t.draft(first)).status, 401, "the old token stops working");
    assert.equal((await t.draft(again)).status, 200);
  });

  test("nothing identifying is stored in the clear", async () => {
    const d = await t.install({ headers: { "x-xaigc-client": "4.0.0" } });
    const { rows } = await t.db.query("SELECT * FROM devices WHERE id = $1", [d.deviceId]);
    const row = JSON.stringify(rows[0]);
    assert.ok(!row.includes(d.token), "the token is hashed");
    assert.ok(!row.includes(d.installId), "the install id is hashed");
    assert.ok(!row.includes(d.ip), "the network address is hashed");
    assert.equal(rows[0].client_version, "4.0.0");
  });

  test("one network cannot inflate the count of installs", async () => {
    const t2 = await createTestApp({ DEVICES_PER_IP_PER_DAY: "3" });
    try {
      const ip = nextIp();
      for (let i = 0; i < 3; i++) await t2.install({ ip });
      const res = await t2.call("POST", "/v1/devices", { body: { installId: newInstallId() }, ip });
      assert.equal(res.status, 429);
      assert.equal(res.body.error.code, "too_many_devices");
      await t2.install(); // another network is fine
    } finally {
      await t2.close();
    }
  });
});

describe("drafts", () => {
  let t;
  before(async () => (t = await createTestApp()));
  after(() => t.close());

  test("a draft report needs a valid token", async () => {
    assert.equal((await t.call("POST", "/v1/usage", { body: { kind: "reply" } })).status, 401);
    assert.equal((await t.call("POST", "/v1/usage", { token: "xd_nope", body: { kind: "reply" } })).status, 401);
  });

  test("only a kind is taken: anything else is dropped before it is read", async () => {
    const d = await t.install();
    for (const body of [{}, { kind: "essay" }, { kind: 3 }]) {
      assert.equal((await t.call("POST", "/v1/usage", { token: d.token, body })).status, 400, JSON.stringify(body));
    }
    // A client that sends more than the kind (it never should) is counted,
    // and the rest is thrown away: it is not stored anywhere.
    const leaky = await t.call("POST", "/v1/usage", { token: d.token, body: { kind: "reply", text: "SECRET POST TEXT", draft: "SECRET DRAFT" } });
    assert.equal(leaky.status, 200);
    const everything = JSON.stringify((await t.db.query("SELECT * FROM usage_daily")).rows) + JSON.stringify((await t.db.query("SELECT * FROM devices")).rows);
    assert.ok(!everything.includes("SECRET"), "no text reaches the database");
    for (const kind of ["reply", "question", "quote", "post", "thread", "rewrite"]) {
      const res = await t.draft(d, kind);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { ok: true, counted: true });
    }
  });

  test("drafts are counted per day and per kind", async () => {
    const t2 = await createTestApp();
    try {
      const a = await t2.install();
      const b = await t2.install();
      for (let i = 0; i < 3; i++) await t2.draft(a, "reply");
      await t2.draft(a, "post");
      await t2.draft(b, "question");
      const s = (await t2.stats()).body;
      assert.equal(s.today.drafts, 5);
      assert.deepEqual({ reply: s.today.kinds.reply, post: s.today.kinds.post, question: s.today.kinds.question, thread: s.today.kinds.thread }, { reply: 3, post: 1, question: 1, thread: 0 });
      assert.equal(s.drafts.total, 5);
      assert.equal(s.installs.writers, 2);
      const { rows } = await t2.db.query("SELECT total_generations FROM devices WHERE id = $1", [a.deviceId]);
      assert.equal(rows[0].total_generations, 4);

      t2.advance(DAY);
      await t2.draft(a, "reply");
      const later = (await t2.stats()).body;
      assert.equal(later.today.drafts, 1, "a new UTC day starts from nothing");
      assert.equal(later.days[1].drafts, 5, "yesterday is kept");
      assert.equal(later.drafts.total, 6);
      assert.equal(later.drafts.last7d, 6);
    } finally {
      await t2.close();
    }
  });

  test("one install cannot inflate the count", async () => {
    const t2 = await createTestApp({ DRAFTS_PER_DEVICE_PER_DAY: "3", RL_DRAFTS_PER_DEVICE_PER_MIN: "2" });
    try {
      const d = await t2.install();
      assert.equal((await t2.draft(d)).status, 200);
      assert.equal((await t2.draft(d)).status, 200);
      const fast = await t2.draft(d);
      assert.equal(fast.status, 429, "too many in a minute");
      t2.advance(61_000);
      assert.deepEqual((await t2.draft(d)).body, { ok: true, counted: true });
      t2.advance(61_000);
      assert.deepEqual((await t2.draft(d)).body, { ok: true, counted: false }, "past a day's worth, reports are accepted but not counted");
      assert.equal((await t2.stats()).body.today.drafts, 3);
    } finally {
      await t2.close();
    }
  });

  test("a blocked install is refused", async () => {
    const d = await t.install();
    await t.db.query("UPDATE devices SET blocked = true WHERE id = $1", [d.deviceId]);
    assert.equal((await t.draft(d)).status, 403);
  });
});

describe("the extension's origin", () => {
  test("with ALLOWED_ORIGINS set, only the extension may register and report", async () => {
    const t = await createTestApp({ ALLOWED_ORIGINS: EXT_ORIGIN });
    try {
      const blocked = await t.call("POST", "/v1/devices", { body: { installId: newInstallId() }, headers: { origin: "https://evil.example" } });
      assert.equal(blocked.status, 403);
      assert.equal(blocked.body.error.code, "origin_not_allowed");
      assert.equal((await t.call("POST", "/v1/devices", { body: { installId: newInstallId() } })).status, 403, "no origin at all");
      const d = await t.install({ headers: { origin: EXT_ORIGIN } });
      assert.equal((await t.draft(d, "reply", { headers: { origin: EXT_ORIGIN } })).status, 200);
      assert.equal((await t.draft(d, "reply", { headers: { origin: "https://evil.example" } })).status, 403);
    } finally {
      await t.close();
    }
  });

  test("CORS answers the extension's preflight", async () => {
    const t = await createTestApp({ ALLOWED_ORIGINS: EXT_ORIGIN });
    try {
      const res = await t.call("OPTIONS", "/v1/usage", { headers: { origin: EXT_ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type,x-xaigc-client" } });
      assert.equal(res.status, 204);
      assert.equal(res.headers["access-control-allow-origin"], EXT_ORIGIN);
    } finally {
      await t.close();
    }
  });
});

describe("admin", () => {
  let t;
  before(async () => (t = await createTestApp()));
  after(() => t.close());

  test("the dashboard and its data need the admin token", async () => {
    assert.equal((await t.call("GET", "/admin/api/stats")).status, 401);
    assert.equal((await t.call("GET", "/admin/api/stats", { token: "wrong-token-wrong-token-wrong" })).status, 401);
    const page = await t.call("GET", "/admin");
    assert.equal(page.status, 200);
    assert.match(page.headers["content-security-policy"], /script-src 'self'/);
    assert.match(page.raw, /Installs and comments/);
  });

  test("stats: users, active users, comments and 30 days of history", async () => {
    const a = await t.install({ headers: { "x-xaigc-client": "4.0.0" } });
    await t.install({ headers: { "x-xaigc-client": "4.0.0" } });
    await t.draft(a, "thread");
    const s = (await t.stats()).body;
    assert.equal(s.installs.total, 2);
    assert.equal(s.installs.new24h, 2);
    assert.equal(s.installs.active24h, 2);
    assert.equal(s.today.installs, 2);
    assert.equal(s.today.drafts, 1);
    assert.equal(s.today.kinds.thread, 1);
    assert.equal(s.days.length, 30);
    assert.deepEqual(s.kinds, ["reply", "question", "quote", "post", "thread", "rewrite"]);
    assert.deepEqual(s.versions, [{ version: "4.0.0", installs: 2 }]);
    assert.equal(s.caller.source, "x-real-ip");
  });

  test("too many wrong admin tokens slow the guesser down, never the real admin", async () => {
    const t2 = await createTestApp({ ADMIN_FAILURES_PER_15MIN: "2" });
    try {
      const wrong = () => t2.call("GET", "/admin/api/stats", { token: "wrong-token-wrong-token-wrong", ip: "198.51.100.9" });
      await wrong();
      await wrong();
      assert.equal((await wrong()).status, 429);
      assert.equal((await t2.call("GET", "/admin/api/stats", { token: ADMIN_TOKEN, ip: "198.51.100.9" })).status, 200);
    } finally {
      await t2.close();
    }
  });

  test("without ADMIN_TOKEN the dashboard does not exist", async () => {
    const t2 = await createTestApp({ ADMIN_TOKEN: "" });
    try {
      assert.equal((await t2.call("GET", "/admin")).status, 404);
      assert.equal((await t2.call("GET", "/admin/api/stats", { token: ADMIN_TOKEN })).status, 404);
    } finally {
      await t2.close();
    }
  });
});

describe("basics", () => {
  test("health and the API's name, and no routes from the old server", async () => {
    const t = await createTestApp();
    try {
      assert.deepEqual((await t.call("GET", "/health")).body, { ok: true, version: t.config.version });
      assert.equal((await t.call("GET", "/")).body.name, "XAICG API");
      for (const [method, path] of [["POST", "/v1/generate"], ["GET", "/v1/me"], ["POST", "/v1/license/activate"], ["POST", "/v1/auth/google"], ["GET", "/admin/api/licenses"]]) {
        assert.equal((await t.call(method, path, { body: {} })).status, 404, `${method} ${path}`);
      }
    } finally {
      await t.close();
    }
  });
});
