import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config.js";
import { checkTokenInfo, GoogleAuthError, readProfile } from "../src/services/google.js";
import { chatResponse, createTestApp, EXT_ORIGIN, GOOGLE, nextIp } from "./helpers.js";

const alice = { sub: "google-sub-alice", email: "alice@example.com", name: "Alice Example" };
const bob = { sub: "google-sub-bob", email: "bob@example.com", name: "Bob Example" };
const person = (n) => ({ sub: `google-sub-${n}`, email: `${n}@example.com`, name: `${n} person` });

/* ----------------------------- token validation ---------------------------- */

describe("Google identity checks", () => {
  const config = loadConfig(GOOGLE);
  const now = Date.parse("2026-11-14T00:00:00Z");
  const info = { azp: GOOGLE.GOOGLE_CLIENT_ID, aud: GOOGLE.GOOGLE_CLIENT_ID, sub: "123", exp: String(now / 1000 + 600) };
  const profile = { sub: "123", email: "Someone@Example.com", email_verified: true, name: " Some One " };
  const rejects = (fn, code) => assert.throws(fn, (err) => err instanceof GoogleAuthError && err.code === code);

  test("a token is accepted only if it was issued to this product's own client", () => {
    assert.equal(checkTokenInfo(config, info, { now }), info);
    rejects(() => checkTokenInfo(config, { ...info, aud: "another-app.apps.googleusercontent.com" }, { now }), "bad_audience");
    rejects(() => checkTokenInfo(config, { ...info, azp: "another-app.apps.googleusercontent.com" }, { now }), "bad_audience");
    rejects(() => checkTokenInfo(config, { ...info, aud: undefined }, { now }), "bad_audience");
    rejects(() => checkTokenInfo(config, { ...info, exp: String(now / 1000 - 1) }, { now }), "expired");
    rejects(() => checkTokenInfo(config, { ...info, exp: undefined }, { now }), "expired");
    rejects(() => checkTokenInfo(config, null, { now }), "bad_token");
  });

  test("several client IDs can be configured, for a development copy of the extension", () => {
    const two = loadConfig({ GOOGLE_CLIENT_ID: `${GOOGLE.GOOGLE_CLIENT_ID}, dev-copy.apps.googleusercontent.com` });
    assert.deepEqual(two.google.clientIds, [GOOGLE.GOOGLE_CLIENT_ID, "dev-copy.apps.googleusercontent.com"]);
    assert.ok(checkTokenInfo(two, { ...info, aud: "dev-copy.apps.googleusercontent.com", azp: "dev-copy.apps.googleusercontent.com" }, { now }));
  });

  test("the profile is normalized, and must be a verified address for the same account", () => {
    assert.deepEqual(readProfile(profile, info), { sub: "123", email: "someone@example.com", name: "Some One" });
    assert.equal(readProfile({ ...profile, email_verified: "true", name: undefined }, info).name, null);
    rejects(() => readProfile({ ...profile, sub: "" }, info), "bad_token");
    rejects(() => readProfile({ ...profile, sub: "456" }, info), "bad_token");
    rejects(() => readProfile({ ...profile, email: undefined }, info), "no_email");
    rejects(() => readProfile({ ...profile, email_verified: false }, info), "email_unverified");
    rejects(() => readProfile({ ...profile, email_verified: undefined }, info), "email_unverified");
    rejects(() => readProfile(null, info), "bad_token");
  });

  test("the server needs only the client ID: no secret, no public address", () => {
    assert.equal(loadConfig(GOOGLE).google.enabled, true);
    assert.equal(loadConfig({}).google.enabled, false);
    assert.throws(() => loadConfig({ NODE_ENV: "production", GOOGLE_CLIENT_ID: "GOCSPX-this-is-a-secret-not-an-id" }), /Chrome Extension/);
  });
});

/* --------------------------------- sign-in --------------------------------- */

describe("sign in with Google", () => {
  let t;
  before(async () => (t = await createTestApp(GOOGLE)));
  after(() => t.close());

  test("a new browser is asked to sign in before the trial starts", async () => {
    const d = await t.install();
    assert.equal(d.account.user, null);
    assert.deepEqual(d.account.auth, { google: true, signInRequired: true });
    const res = await t.generate(d);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "sign_in_required");
    assert.equal(t.fake.chatCalls().length, 0);
  });

  test("signing in creates the account and starts the trial", async () => {
    const d = await t.install();
    const res = await t.signIn(d, alice);
    assert.equal(res.status, 200);
    assert.equal(res.body.created, true);
    assert.deepEqual(res.body.account.user, { email: "alice@example.com", name: "Alice Example" });
    assert.equal(res.body.account.auth.signInRequired, false);
    assert.equal(res.body.account.plan, "trial");

    const users = await t.db.query("SELECT google_sub, email, name FROM users");
    assert.deepEqual(users.rows, [{ google_sub: "google-sub-alice", email: "alice@example.com", name: "Alice Example" }]);
    assert.equal((await t.generate(d)).status, 200);
    assert.equal((await t.me(d)).body.account.user.email, "alice@example.com");

    // What Google was asked: who the token belongs to, and nothing else.
    const asked = t.fake.google.calls.slice(-2);
    assert.deepEqual(asked.map((c) => [c.endpoint, c.method]), [["tokeninfo", "GET"], ["userinfo", "GET"]]);
    // The token is not kept anywhere.
    const stored = JSON.stringify((await t.db.query("SELECT * FROM users")).rows) + JSON.stringify((await t.db.query("SELECT * FROM devices")).rows);
    assert.ok(!stored.includes("ya29."), "no Google token is stored");
  });

  test("signing in again finds the same account and refreshes its details", async () => {
    const d = await t.install();
    const res = await t.signIn(d, { ...alice, email: "alice.new@example.com", name: "Alice Renamed" });
    assert.equal(res.body.created, false);
    const users = await t.db.query("SELECT email, name FROM users WHERE google_sub = $1", [alice.sub]);
    assert.deepEqual(users.rows, [{ email: "alice.new@example.com", name: "Alice Renamed" }]);
    await t.signIn(d, alice); // put it back for later tests
  });

  test("one free trial per Google account, whatever the browser or network", async () => {
    const carol = person("carol");
    const first = await t.install();
    await t.signIn(first, carol);
    for (let i = 0; i < 3; i++) assert.equal((await t.generate(first)).status, 200);
    assert.equal((await t.generate(first)).status, 402);

    const second = await t.install(); // new install, new network
    const signedIn = await t.signIn(second, carol);
    assert.equal(signedIn.body.account.quota.remaining, 0, "the account's trial is already spent");
    assert.equal(signedIn.body.account.quota.limitedBy, "user");
    const res = await t.generate(second);
    assert.equal(res.status, 402);
    assert.equal(res.body.error.code, "trial_ended");
  });

  test("a token issued to another app cannot be replayed here", async () => {
    // Some other app (or site) the victim used holds a perfectly valid Google
    // token for them. Presenting it here must not sign anyone in as them.
    const attacker = await t.install();
    const foreign = t.fake.google.mint(person("victim"), { clientId: "some-other-app.apps.googleusercontent.com" });
    const res = await t.signInWith(attacker, foreign);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "google_token_rejected");
    assert.equal((await t.me(attacker)).body.account.user, null);
    assert.equal((await t.db.query("SELECT 1 FROM users WHERE email = 'victim@example.com'")).rows.length, 0, "no account was created");
  });

  test("a sign-in applies to the install that presents it, and no other", async () => {
    const mine = await t.install();
    const other = await t.install();
    await t.signIn(mine, person("gina"));
    assert.equal((await t.me(mine)).body.account.user.email, "gina@example.com");
    assert.equal((await t.me(other)).body.account.user, null);
  });

  test("tokens that are not a valid, verified sign-in for this app are refused", async () => {
    const d = await t.install();
    const before = (await t.db.query("SELECT count(*)::int AS n FROM users")).rows[0].n;
    const refused = async (overrides, why) => {
      const res = await t.signInWith(d, t.fake.google.mint(person("mallory"), overrides));
      assert.equal(res.status, 400, why);
      assert.equal(res.body.error.code, "google_token_rejected", why);
    };
    await refused({ info: { aud: "someone-else.apps.googleusercontent.com" } }, "wrong audience");
    await refused({ info: { azp: "someone-else.apps.googleusercontent.com" } }, "wrong authorized party");
    await refused({ info: { exp: String(Math.floor(Date.now() / 1000) - 3600) } }, "expired");
    await refused({ profile: { email_verified: false } }, "unverified email");
    await refused({ profile: { email: undefined } }, "no email");
    await refused({ profile: { sub: "" } }, "no account id");
    await refused({ profile: { sub: "google-sub-someone-else" } }, "the two answers disagree about the account");

    // A token Google does not recognize.
    const unknown = await t.signInWith(d, "ya29.never-issued-never-issued-never-issued");
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.code, "google_token_rejected");
    assert.match(unknown.body.error.message, /Google did not accept that sign-in/);

    // Malformed requests never reach Google.
    const asked = t.fake.google.calls.length;
    assert.equal((await t.call("POST", "/v1/auth/google", { token: d.token, body: {} })).status, 400);
    assert.equal((await t.call("POST", "/v1/auth/google", { token: d.token, body: { accessToken: "short" } })).status, 400);
    assert.equal((await t.call("POST", "/v1/auth/google", { token: d.token, body: { accessToken: "x".repeat(5000) } })).status, 400);
    assert.equal(t.fake.google.calls.length, asked);

    assert.equal((await t.db.query("SELECT count(*)::int AS n FROM users")).rows[0].n, before, "no accounts were created");
    assert.equal((await t.me(d)).body.account.user, null);
  });

  test("if Google cannot be reached the person is told to try again", async () => {
    const d = await t.install();
    t.fake.google.down = true;
    try {
      const res = await t.signInWith(d, t.fake.google.mint(person("harold")));
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, "google_unreachable");
    } finally {
      t.fake.google.down = false;
    }
    assert.equal((await t.signIn(d, person("harold"))).status, 200, "and it works once Google answers");
  });

  test("the server has no sign-in pages: nothing for a browser to be redirected to", async () => {
    for (const path of ["/auth/google/callback?code=a&state=b", "/auth/done", "/auth/style.css"]) {
      assert.equal((await t.call("GET", path)).status, 404, path);
    }
    const d = await t.install();
    assert.equal((await t.call("POST", "/v1/auth/google/start", { token: d.token })).status, 404);
    assert.equal((await t.call("POST", "/v1/auth/google/complete", { token: d.token, body: { code: "ac_0123456789" } })).status, 404);
  });

  test("signing out", async () => {
    const d = await t.install();
    await t.signIn(d, person("dana"));
    const out = await t.signOut(d);
    assert.equal(out.status, 200);
    assert.equal(out.body.account.user, null);
    assert.equal(out.body.account.auth.signInRequired, true);
    assert.equal((await t.generate(d)).status, 403);
    assert.equal((await t.signOut(d)).status, 200, "signing out twice is harmless");
  });

  test("sign-in attempts are rate limited per install", async () => {
    const limited = await createTestApp({ ...GOOGLE, SIGN_IN_STARTS_PER_10MIN: "2" });
    try {
      const d = await limited.install();
      assert.equal((await limited.signIn(d, person("ivy"))).status, 200);
      assert.equal((await limited.signInWith(d, "ya29.not-a-real-token-not-a-real-token")).status, 400);
      const third = await limited.signIn(d, person("ivy"));
      assert.equal(third.status, 429);
      assert.equal((await limited.signIn(await limited.install(), person("ivy"))).status, 200);
    } finally {
      await limited.close();
    }
  });

  test("signing in and out need the install's own token", async () => {
    assert.equal((await t.call("POST", "/v1/auth/google", { body: { accessToken: t.fake.google.mint(person("jon")) } })).status, 401);
    assert.equal((await t.call("POST", "/v1/auth/signout")).status, 401);
  });
});

/* ----------------------------- configuration ------------------------------ */

describe("sign-in configuration", () => {
  test("without Google credentials, sign-in is off and the trial works as before", async () => {
    const t = await createTestApp();
    try {
      const d = await t.install();
      assert.deepEqual(d.account.auth, { google: false, signInRequired: false });
      const attempt = await t.signIn(d, person("nobody"));
      assert.equal(attempt.status, 404);
      assert.equal(attempt.body.error.code, "sign_in_unavailable");
      assert.equal(t.fake.google.calls.length, 0, "Google is not asked when sign-in is off");
      assert.equal((await t.generate(d)).status, 200);
    } finally {
      await t.close();
    }
  });

  test("TRIAL_REQUIRE_SIGN_IN=false keeps sign-in optional, and the account still counts", async () => {
    const t = await createTestApp({ ...GOOGLE, TRIAL_REQUIRE_SIGN_IN: "false" });
    try {
      const d = await t.install();
      assert.deepEqual(d.account.auth, { google: true, signInRequired: false });
      assert.equal((await t.generate(d)).status, 200, "one generation without an account");
      await t.signIn(d, person("erin"));
      assert.equal((await t.generate(d)).status, 200);
      assert.equal((await t.generate(d)).status, 200);
      assert.equal((await t.generate(d)).status, 402, "the install's three are used");
      const other = await t.install();
      await t.signIn(other, person("erin"));
      assert.equal((await t.generate(other)).status, 200, "the account had used only two while signed in");
      assert.equal((await t.generate(other)).status, 402, "and now its three are used too");
    } finally {
      await t.close();
    }
  });

  test("with the API locked to the extension's origin, only the extension can sign in", async () => {
    const t = await createTestApp({ ...GOOGLE, ALLOWED_ORIGINS: EXT_ORIGIN });
    try {
      const origin = { origin: EXT_ORIGIN };
      const reg = await t.call("POST", "/v1/devices", { body: { installId: "install-id-for-origin-test-0001" }, ip: nextIp(), headers: origin });
      const accessToken = t.fake.google.mint(person("fay"));
      assert.equal((await t.call("POST", "/v1/auth/google", { token: reg.body.token, body: { accessToken } })).status, 403, "not from another origin");
      assert.equal((await t.call("POST", "/v1/auth/google", { token: reg.body.token, body: { accessToken }, headers: { origin: "https://evil.example" } })).status, 403);
      const done = await t.call("POST", "/v1/auth/google", { token: reg.body.token, body: { accessToken }, headers: origin });
      assert.equal(done.status, 200);
      assert.equal(done.body.account.user.email, "fay@example.com");
    } finally {
      await t.close();
    }
  });
});

/* -------------------------- licenses and accounts -------------------------- */

describe("licenses follow the account they were issued to", () => {
  let t;
  before(async () => (t = await createTestApp(GOOGLE)));
  after(() => t.close());

  const owner = async (lic) => (await t.admin("GET", `/licenses/${lic.id}`)).body.license.owner;
  const seat = async (d) => (await t.db.query("SELECT seat_source FROM devices WHERE id = $1", [d.deviceId])).rows[0].seat_source;

  test("a license issued to an email is there when that person signs up", async () => {
    const lic = await t.license({ email: "Ivy@Example.com", days: 30 });
    assert.equal(lic.owner, null, "nobody has that account yet");
    const d = await t.install();
    const res = await t.signIn(d, person("ivy"));
    assert.equal(res.body.account.licensed, true, "no key was ever typed");
    assert.equal(res.body.account.license.hint, lic.hint);
    assert.ok(res.body.account.license.expiresAt, "the 30 days started at this first use");
    assert.equal((await owner(lic)).email, "ivy@example.com");
    assert.equal(await seat(d), "account");
  });

  test("it follows the account to other browsers, within its seats", async () => {
    const gina = person("gina");
    const lic = await t.license({ email: gina.email, maxDevices: 2 });
    const laptop = await t.install();
    const desktop = await t.install();
    const tablet = await t.install();
    assert.equal((await t.signIn(laptop, gina)).body.account.licensed, true);
    const second = await t.signIn(desktop, gina);
    assert.equal(second.body.account.licensed, true, "just signed in, no key");
    assert.equal(second.body.account.license.devicesUsed, 2);

    // Third browser: seats are full, so nothing is taken from anyone...
    const full = await t.signIn(tablet, gina);
    assert.equal(full.body.account.licensed, false);
    assert.deepEqual(
      { plan: full.body.account.accountLicense.plan, used: full.body.account.accountLicense.devicesUsed, max: full.body.account.accountLicense.maxDevices, reason: full.body.account.accountLicense.reason },
      { plan: "Pro", used: 2, max: 2, reason: "device_limit" },
    );
    // ...not even when asked, unless the user says to replace a browser.
    const refused = await t.attach(tablet);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, "device_limit");
    assert.equal((await t.me(laptop)).body.account.licensed, true);
    assert.equal((await t.me(desktop)).body.account.licensed, true);

    await t.db.query("UPDATE devices SET last_seen_at = now() - interval '9 days' WHERE id = $1", [laptop.deviceId]);
    const moved = await t.attach(tablet, { replaceOldest: true });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.account.licensed, true);
    assert.equal(moved.body.account.accountLicense, null);
    assert.equal((await t.me(laptop)).body.account.licensed, false, "the browser idle longest gave up its seat");
    assert.equal((await t.me(desktop)).body.account.licensed, true);
    assert.equal((await owner(lic)).email, gina.email);
  });

  test("a license granted to an existing user works on their very next click", async () => {
    const jo = person("jo");
    const d = await t.install();
    await t.signIn(d, jo);
    for (let i = 0; i < 3; i++) await t.generate(d);
    assert.equal((await t.generate(d)).status, 402, "trial used up");

    const lic = await t.license({ email: jo.email });
    assert.equal(lic.owner.email, jo.email, "linked to the account at creation");
    const res = await t.generate(d);
    assert.equal(res.status, 200, "no refresh, no key, no re-login");
    assert.equal(res.body.account.plan, "pro");
  });

  test("looking at the account changes nothing; the license is taken with a POST", async () => {
    const kai = person("kai");
    const d = await t.install();
    await t.signIn(d, kai);
    const lic = await t.license({ email: kai.email, days: 30 });
    const me = await t.me(d);
    assert.equal(me.body.account.licensed, false);
    assert.equal(me.body.account.accountLicense.reason, "available");
    const row = await t.db.query("SELECT first_activated_at, expires_at FROM licenses WHERE id = $1", [lic.id]);
    assert.equal(row.rows[0].first_activated_at, null, "a GET did not start the 30 days");
    assert.equal(row.rows[0].expires_at, null);
    assert.equal(await seat(d), null, "and did not take a seat");
    const attached = await t.attach(d);
    assert.equal(attached.status, 200);
    assert.equal(attached.body.account.licensed, true);
    assert.ok(attached.body.account.license.expiresAt);
  });

  test("a key gives a seat, never ownership", async () => {
    // Signed in, then the key.
    const lic = await t.license({ maxDevices: 2 });
    const d = await t.install();
    await t.signIn(d, person("lou"));
    assert.equal((await t.activate(d, lic.key)).body.account.licensed, true);
    assert.equal(await owner(lic), null);
    assert.equal(await seat(d), "key");

    // The key first, then signing in.
    const e = await t.install();
    assert.equal((await t.activate(e, lic.key)).status, 200, "a key works without an account");
    assert.equal((await t.generate(e)).status, 200, "and licensed use never requires signing in");
    await t.signIn(e, person("mel"));
    assert.equal(await owner(lic), null, "signing in on a licensed browser does not make you its owner");

    // So neither account can take the license anywhere without the key.
    const elsewhere = await t.install();
    assert.equal((await t.signIn(elsewhere, person("mel"))).body.account.licensed, false);
    const grab = await t.attach(elsewhere);
    assert.equal(grab.status, 404);
    assert.equal(grab.body.error.code, "no_account_license");
  });

  test("holding one seat of someone's license gives no way to take the others", async () => {
    // The buyer activates a two-seat key on their own browser and on a
    // colleague's. Neither is signed in. Then the colleague signs in.
    const lic = await t.license({ maxDevices: 2, email: "buyer@example.com" });
    const buyer = await t.install();
    const colleague = await t.install();
    await t.activate(buyer, lic.key);
    await t.activate(colleague, lic.key);
    await t.signIn(colleague, person("colleague"));
    assert.equal(await owner(lic), null);

    const home = await t.install();
    await t.signIn(home, person("colleague"));
    assert.equal((await t.attach(home, { replaceOldest: true })).status, 404, "no key, no ownership, no seat");
    assert.equal((await t.me(buyer)).body.account.licensed, true, "the buyer's browser is untouched");

    // The admin rotates the key and releases every browser. The colleague's
    // access ends there; only the real owner comes back.
    const rotated = await t.admin("POST", `/licenses/${lic.id}/rotate`);
    await t.admin("POST", `/licenses/${lic.id}/reset-devices`);
    assert.equal((await t.me(colleague)).body.account.licensed, false);
    assert.equal((await t.generate(colleague)).body.account?.licensed ?? false, false);
    assert.equal((await t.attach(colleague)).status, 404);
    assert.equal((await t.activate(colleague, lic.key)).status, 404, "the old key is dead");

    const real = await t.signIn(buyer, { sub: "google-sub-buyer", email: "buyer@example.com", name: "Buyer" });
    assert.equal(real.body.account.licensed, true, "the account it was issued to gets it back by signing in");
    assert.equal((await owner(lic)).email, "buyer@example.com");
    assert.equal((await t.activate(await t.install(), rotated.body.key)).status, 200, "and the new key works");
  });

  test("a license issued to one person is not captured by whoever enters the key first", async () => {
    const lic = await t.license({ email: "kim@example.com", maxDevices: 2 });
    const other = await t.install();
    await t.signIn(other, person("not-kim"));
    assert.equal((await t.activate(other, lic.key)).status, 200, "the key still gives them a seat");
    assert.equal(await owner(lic), null);
    const kim = await t.install();
    const res = await t.signIn(kim, person("kim"));
    assert.equal(res.body.account.licensed, true);
    assert.equal((await owner(lic)).email, "kim@example.com");
  });

  test("another person's email does not claim a license", async () => {
    await t.license({ email: "nina@example.com" });
    const d = await t.install();
    const res = await t.signIn(d, person("not-nina"));
    assert.equal(res.body.account.licensed, false);
    assert.equal(res.body.account.accountLicense, null);
  });

  test("an address that moved to another Google account takes its licenses with it", async () => {
    // Account A held shared@ and is still signed in somewhere. The address
    // then moves to account B, which signs in.
    const stale = await t.install();
    await t.signIn(stale, { sub: "sub-old-holder", email: "shared@example.com", name: "Old Holder" });
    const current = await t.install();
    await t.signIn(current, { sub: "sub-new-holder", email: "shared@example.com", name: "New Holder" });

    const lic = await t.license({ email: "shared@example.com" });
    const linked = await t.db.query("SELECT u.google_sub FROM licenses l JOIN users u ON u.id = l.user_id WHERE l.id = $1", [lic.id]);
    assert.equal(linked.rows[0].google_sub, "sub-new-holder", "linked to the account that holds the address now");
    assert.equal((await t.me(stale)).body.account.accountLicense, null);
    assert.equal((await t.attach(stale)).status, 404, "the old holder's lingering session gets nothing");
    assert.equal((await t.generate(current)).body.account.licensed, true);

    // Even an unowned license addressed to it cannot be claimed by the stale row.
    await t.db.query("UPDATE licenses SET user_id = NULL WHERE id = $1", [lic.id]);
    await t.db.query("UPDATE devices SET license_id = NULL, seat_source = NULL WHERE license_id = $1", [lic.id]);
    assert.equal((await t.attach(stale)).status, 404);
    assert.equal((await t.attach(current)).status, 200);
  });

  test("removing a license from a browser sticks, for that license only", async () => {
    const lee = person("lee");
    const lic = await t.license({ email: lee.email });
    const d = await t.install();
    assert.equal((await t.signIn(d, lee)).body.account.licensed, true);

    const off = await t.deactivate(d);
    assert.equal(off.body.account.licensed, false);
    assert.equal(off.body.account.accountLicense.reason, "detached");
    assert.equal((await t.me(d)).body.account.licensed, false, "it does not hop straight back");
    const gen = await t.generate(d);
    assert.equal(gen.status, 200, "the free trial is still there");
    assert.equal(gen.body.account.licensed, false);
    assert.equal(gen.body.account.accountLicense.reason, "detached", "and the offer to bring it back is not lost");

    // A different license issued to the same person is not held back by that.
    await t.admin("PATCH", `/licenses/${lic.id}`, { status: "revoked" });
    const fresh = await t.license({ email: lee.email, plan: "agency" });
    const next = await t.generate(d);
    assert.equal(next.body.account.licensed, true);
    assert.equal(next.body.account.license.hint, fresh.hint);

    // And the removed one comes back when asked for.
    await t.admin("PATCH", `/licenses/${fresh.id}`, { status: "revoked" });
    await t.admin("PATCH", `/licenses/${lic.id}`, { status: "active" });
    await t.deactivate(d);
    assert.equal((await t.me(d)).body.account.accountLicense.reason, "available", "the one removed just now was the revoked one");
    const back = await t.attach(d);
    assert.equal(back.body.account.license.hint, lic.hint);
  });

  test("signing out takes back a seat that came with the account, not one from a key", async () => {
    const max = person("max");
    const lic = await t.license({ email: max.email, maxDevices: 2 });
    const byAccount = await t.install();
    await t.signIn(byAccount, max);
    assert.equal(await seat(byAccount), "account");
    const out = await t.signOut(byAccount);
    assert.equal(out.body.account.licensed, false);
    assert.equal(out.body.account.user, null);

    // Key first, then sign in, then sign out: the browser keeps what the key gave it.
    const byKey = await t.install();
    await t.activate(byKey, lic.key);
    await t.signIn(byKey, max);
    assert.equal(await seat(byKey), "key");
    const stays = await t.signOut(byKey);
    assert.equal(stays.body.account.licensed, true);
    assert.equal((await t.generate(byKey)).status, 200, "and it can still generate, signed out");
  });

  test("signing in as someone else gives back the first account's seat", async () => {
    const ann = person("ann");
    await t.license({ email: ann.email });
    const d = await t.install();
    assert.equal((await t.signIn(d, ann)).body.account.licensed, true);
    const other = await t.signIn(d, person("ben"));
    assert.equal(other.body.account.user.email, "ben@example.com");
    assert.equal(other.body.account.licensed, false, "ben does not inherit ann's license");
    assert.equal((await t.signOut(d)).body.account.licensed, false);
  });

  test("blocking an account disables the licenses it owns, on every browser and by key", async () => {
    const zed = person("zed");
    const lic = await t.license({ email: zed.email, maxDevices: 3 });
    const signedIn = await t.install();
    await t.signIn(signedIn, zed);
    const keyOnly = await t.install();
    await t.activate(keyOnly, lic.key);
    assert.equal((await t.generate(keyOnly)).status, 200);

    const user = (await t.admin("GET", "/users?q=zed@")).body.users[0];
    await t.admin("POST", `/users/${user.id}/block`, { blocked: true });
    assert.equal((await t.generate(signedIn)).status, 403);
    const viaKey = (await t.me(keyOnly)).body.account;
    assert.equal(viaKey.licensed, false, "a browser that only ever had the key loses the license too");
    assert.equal(viaKey.notice, "license_revoked");
    const fresh = await t.install();
    const again = await t.activate(fresh, lic.key);
    assert.equal(again.status, 403, "and the key cannot be activated anywhere new");
    assert.equal(again.body.error.code, "license_revoked");

    await t.admin("POST", `/users/${user.id}/block`, { blocked: false });
    assert.equal((await t.me(keyOnly)).body.account.licensed, true);
    assert.equal((await t.activate(fresh, lic.key)).status, 200);
  });

  test("attach needs a signed-in account that has a license", async () => {
    const d = await t.install();
    const anon = await t.attach(d);
    assert.equal(anon.status, 403);
    assert.equal(anon.body.error.code, "sign_in_required");
    await t.signIn(d, person("nolicense"));
    const none = await t.attach(d);
    assert.equal(none.status, 404);
    assert.equal(none.body.error.code, "no_account_license");
  });

  test("a revoked or expired account license is not offered or attached", async () => {
    const pat = person("pat");
    const lic = await t.license({ email: pat.email });
    await t.admin("PATCH", `/licenses/${lic.id}`, { status: "revoked" });
    const d = await t.install();
    assert.equal((await t.signIn(d, pat)).body.account.licensed, false);
    await t.admin("PATCH", `/licenses/${lic.id}`, { status: "active", expiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal((await t.me(d)).body.account.accountLicense, null);
    assert.equal((await t.attach(d)).status, 404);
    await t.admin("PATCH", `/licenses/${lic.id}`, { expiresAt: null });
    assert.equal((await t.me(d)).body.account.accountLicense.reason, "available");
    assert.equal((await t.generate(d)).body.account.licensed, true, "and comes back once it is valid again");
  });

  test("re-addressing a license moves it to the new person", async () => {
    const from = person("from");
    const to = person("to");
    const lic = await t.license({ email: from.email });
    const a = await t.install();
    await t.signIn(a, from);
    assert.equal((await t.me(a)).body.account.licensed, true);
    const b = await t.install();
    await t.signIn(b, to);

    const res = await t.admin("PATCH", `/licenses/${lic.id}`, { email: to.email });
    assert.equal(res.body.license.owner, null, "ownership is released until the new person turns up");
    assert.equal((await t.me(a)).body.account.licensed, false, "the old owner's account seat is gone");
    assert.equal((await t.generate(b)).body.account.licensed, true);
    assert.equal((await owner(lic)).email, to.email);
    // Editing only the note leaves ownership alone.
    await t.admin("PATCH", `/licenses/${lic.id}`, { note: "changed hands" });
    assert.equal((await owner(lic)).email, to.email);
  });

  test("the dashboard can issue a license straight to a user", async () => {
    const d = await t.install();
    await t.signIn(d, person("vip"));
    const user = (await t.admin("GET", "/users?q=vip@")).body.users[0];
    const res = await t.admin("POST", "/licenses", { plan: "pro", userId: user.id });
    assert.equal(res.status, 200);
    assert.equal(res.body.licenses[0].owner.id, user.id);
    assert.equal(res.body.licenses[0].email, "vip@example.com");
    assert.equal((await t.generate(d)).body.account.licensed, true);
    assert.equal((await t.admin("POST", "/licenses", { plan: "pro", userId: "00000000-0000-4000-8000-000000000000" })).status, 400);
  });
});

/* ------------------------------ user management ---------------------------- */

describe("managing users", () => {
  let t;
  let quinn;
  let rita;
  before(async () => {
    t = await createTestApp(GOOGLE);
    quinn = await t.install();
    await t.signIn(quinn, person("quinn"));
    await t.generate(quinn);
    await t.generate(quinn);
    rita = await t.install();
    await t.signIn(rita, person("rita"));
    await t.license({ email: "rita@example.com", plan: "agency" });
    await t.me(rita);
    await t.generate(rita);
  });
  after(() => t.close());

  const find = async (q) => (await t.admin("GET", `/users?q=${encodeURIComponent(q)}`)).body.users[0];

  test("list, search and filter", async () => {
    const all = await t.admin("GET", "/users");
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 2);
    const q = await find("quinn");
    assert.deepEqual(
      { email: q.email, name: q.name, devices: q.devices, generations: q.generations, plan: q.plan, trial: q.trial, activeLicenses: q.activeLicenses, blocked: q.blocked },
      { email: "quinn@example.com", name: "quinn person", devices: 1, generations: 2, plan: null, trial: { used: 2, limit: 3 }, activeLicenses: 0, blocked: false },
    );
    const r = await find("RITA");
    assert.equal(r.plan, "Agency");
    assert.equal(r.activeLicenses, 1);
    assert.equal(r.generations, 1);
    assert.equal((await t.admin("GET", "/users?filter=licensed")).body.users.map((u) => u.email).join(), "rita@example.com");
    assert.equal((await t.admin("GET", "/users?filter=trial")).body.users.map((u) => u.email).join(), "quinn@example.com");
    assert.equal((await t.admin("GET", "/users?q=nobody")).body.total, 0);
    assert.equal((await t.admin("GET", "/users?limit=1&offset=1")).body.users.length, 1);
    assert.equal((await t.call("GET", "/admin/api/users")).status, 401);
  });

  test("user detail shows their browsers and licenses", async () => {
    const r = await find("rita");
    const detail = await t.admin("GET", `/users/${r.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.devices.length, 1);
    assert.equal(detail.body.devices[0].id, rita.deviceId);
    assert.equal(detail.body.devices[0].license.plan, "Agency");
    assert.equal(detail.body.licenses.length, 1);
    assert.equal(detail.body.licenses[0].owner.id, r.id);
    assert.equal(detail.body.licenses[0].key, undefined);
    assert.equal((await t.admin("GET", "/users/00000000-0000-4000-8000-000000000000")).status, 404);
    // Licenses can be found by their owner's email, and the list shows the owner.
    const byOwner = await t.admin("GET", "/licenses?q=rita@example.com");
    assert.equal(byOwner.body.licenses[0].owner.email, "rita@example.com");
  });

  test("stats count users", async () => {
    const stats = await t.admin("GET", "/stats");
    assert.deepEqual(stats.body.users, { total: 2, new24h: 2, active7d: 2, blocked: 0 });
    assert.deepEqual(stats.body.signIn, { google: true, requiredForTrial: true });
  });

  test("blocking a user shuts every one of their browsers out", async () => {
    const q = await find("quinn");
    const second = await t.install();
    await t.signIn(second, person("quinn"));
    const blocked = await t.admin("POST", `/users/${q.id}/block`, { blocked: true, reason: "abuse" });
    assert.equal(blocked.status, 200);
    for (const device of [quinn, second]) {
      for (const res of [await t.me(device), await t.generate(device)]) {
        assert.equal(res.status, 403);
        assert.equal(res.body.error.code, "account_blocked");
      }
    }
    assert.equal((await t.admin("GET", "/users?filter=blocked")).body.total, 1);
    // A blocked account cannot be signed in to from a fresh browser either.
    const fresh = await t.install();
    const done = await t.signIn(fresh, person("quinn"));
    assert.equal(done.status, 403);
    assert.equal(done.body.error.code, "account_blocked");
    assert.equal((await t.me(fresh)).body.account.user, null);

    await t.admin("POST", `/users/${q.id}/block`, { blocked: false });
    assert.equal((await t.me(quinn)).status, 200);
  });

  test("removing the owner turns a license back into a key-only license", async () => {
    const r = await find("rita");
    const lic = (await t.admin("GET", `/users/${r.id}`)).body.licenses[0];
    const res = await t.admin("PATCH", `/licenses/${lic.id}`, { userId: null, email: null });
    assert.equal(res.body.license.owner, null);
    assert.equal((await t.me(rita)).body.account.licensed, true, "it stays on the browser it is active on");
    const other = await t.install();
    assert.equal((await t.signIn(other, person("rita"))).body.account.licensed, false, "but no longer follows the account");
    assert.equal((await t.admin("PATCH", `/licenses/${lic.id}`, { userId: "00000000-0000-4000-8000-000000000000" })).status, 400, "an owner cannot be set by hand");
  });

  test("deleting a user erases who they are, not what they used", async () => {
    const sam = person("sam");
    const lic = await t.license({ email: sam.email, maxDevices: 2 });
    const d = await t.install();
    await t.signIn(d, sam);
    assert.equal((await t.me(d)).body.account.licensed, true);
    const keyBrowser = await t.install();
    await t.activate(keyBrowser, lic.key);
    // Use the whole trial on another browser of theirs first.
    await t.admin("PATCH", `/licenses/${lic.id}`, { status: "revoked" });
    for (let i = 0; i < 3; i++) assert.equal((await t.generate(d)).status, 200);
    await t.admin("PATCH", `/licenses/${lic.id}`, { status: "active" });
    await t.generate(d);
    const s = await find("sam@");

    const res = await t.admin("DELETE", `/users/${s.id}`);
    assert.equal(res.status, 200);
    assert.equal((await t.db.query("SELECT 1 FROM users WHERE id = $1", [s.id])).rows.length, 0);
    const everything = JSON.stringify((await t.db.query("SELECT to_jsonb(l) AS l FROM licenses l")).rows);
    assert.ok(!everything.includes("sam@example.com"), "their email is gone from the licenses too");
    const me = (await t.me(d)).body.account;
    assert.equal(me.user, null);
    assert.equal(me.licensed, false, "the seat that came with the account went with it");
    assert.equal((await t.me(keyBrowser)).body.account.licensed, true, "a seat from the key stays: the license itself is not destroyed");
    const kept = await t.admin("GET", `/licenses/${lic.id}`);
    assert.equal(kept.body.license.owner, null);
    assert.equal(kept.body.license.email, null);
    assert.equal(kept.body.license.state, "active");

    // The same Google account coming back is a new user, without a new free
    // trial and without the license (it is key-only now).
    const back = await t.signIn(d, sam);
    assert.equal(back.body.created, true);
    assert.equal(back.body.account.licensed, false);
    assert.equal(back.body.account.quota.remaining, 0, "deleting an account does not reset its free trial");
    assert.equal((await t.generate(d)).status, 402);
    assert.equal((await t.admin("DELETE", `/users/${s.id}`)).status, 404);
  });
});
