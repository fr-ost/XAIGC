import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config.js";
import { googleAuthUrl, GoogleAuthError, validateClaims } from "../src/services/google.js";
import { chatResponse, createTestApp, EXT_ORIGIN, GOOGLE, nextIp } from "./helpers.js";

const alice = { sub: "google-sub-alice", email: "alice@example.com", name: "Alice Example" };
const bob = { sub: "google-sub-bob", email: "bob@example.com", name: "Bob Example" };
const person = (n) => ({ sub: `google-sub-${n}`, email: `${n}@example.com`, name: `${n} person` });

/* ----------------------------- token validation ---------------------------- */

describe("Google identity checks", () => {
  const config = loadConfig(GOOGLE);
  const now = Date.parse("2026-11-14T00:00:00Z");
  const good = {
    iss: "https://accounts.google.com",
    aud: GOOGLE.GOOGLE_CLIENT_ID,
    sub: "123",
    email: "Someone@Example.com",
    email_verified: true,
    name: " Some One ",
    nonce: "n1",
    exp: now / 1000 + 600,
  };
  const check = (claims) => validateClaims(config, claims, { nonce: "n1", now });
  const rejects = (claims, code) => assert.throws(() => check(claims), (err) => err instanceof GoogleAuthError && err.code === code);

  test("accepts a well-formed identity and normalizes it", () => {
    assert.deepEqual(check(good), { sub: "123", email: "someone@example.com", name: "Some One" });
    assert.deepEqual(check({ ...good, iss: "accounts.google.com", email_verified: "true", name: undefined }).name, null);
  });

  test("rejects anything that is not this app's own fresh, verified sign-in", () => {
    rejects({ ...good, iss: "https://evil.example" }, "bad_issuer");
    rejects({ ...good, aud: "another-app.apps.googleusercontent.com" }, "bad_audience");
    rejects({ ...good, exp: now / 1000 - 3600 }, "expired");
    rejects({ ...good, nonce: "someone-elses" }, "bad_nonce");
    rejects({ ...good, nonce: undefined }, "bad_nonce");
    rejects({ ...good, sub: "" }, "bad_token");
    rejects({ ...good, email: undefined }, "no_email");
    rejects({ ...good, email_verified: false }, "email_unverified");
    rejects({ ...good, email_verified: undefined }, "email_unverified");
    rejects(null, "bad_token");
  });

  test("the authorization URL asks for identity only and returns to this server", () => {
    const url = new URL(googleAuthUrl(config, { state: "st_abc", nonce: "n_abc" }));
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:8787/auth/google/callback");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("scope"), "openid email profile");
    assert.equal(url.searchParams.get("state"), "st_abc");
    assert.equal(url.searchParams.get("nonce"), "n_abc");
    assert.ok(!url.toString().includes(GOOGLE.GOOGLE_CLIENT_SECRET));
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

    // What was sent to Google: the code, our secret, our callback. Nothing else.
    const sent = t.fake.google.tokenCalls.at(-1);
    assert.deepEqual(Object.keys(sent).sort(), ["client_id", "client_secret", "code", "grant_type", "redirect_uri"]);
    assert.equal(sent.grant_type, "authorization_code");
    assert.equal(sent.redirect_uri, "http://localhost:8787/auth/google/callback");
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

  test("a sign-in link sent to someone else gains nothing", async () => {
    // The attacker starts a sign-in for their own install and tricks a victim
    // into opening the link. The victim really does sign in at Google.
    const attacker = await t.install();
    const victimInstall = await t.install();
    const flow = await t.startSignIn(attacker);
    const back = await t.googleReturns(flow, person("victim"));
    assert.ok(back.completion, "the victim's browser lands on the done page holding a completion code");

    // The attacker never sees that code, and guessing is hopeless.
    assert.equal((await t.completeSignIn(attacker, "ac_guess-guess-guess-guess")).status, 400);
    assert.equal((await t.me(attacker)).body.account.user, null, "the attacker is not signed in as the victim");

    // The victim's own install holds the code but did not start this sign-in.
    const wrongInstall = await t.completeSignIn(victimInstall, back.completion);
    assert.equal(wrongInstall.status, 400);
    assert.equal(wrongInstall.body.error.code, "sign_in_expired");
    assert.equal((await t.me(victimInstall)).body.account.user, null);
    assert.equal((await t.db.query("SELECT 1 FROM users WHERE email = 'victim@example.com'")).rows.length, 0, "no account was created");

    // Only the install that started it, holding the code, completes it.
    assert.equal((await t.completeSignIn(attacker, back.completion)).status, 200);
    // ...and the code is single use.
    assert.equal((await t.completeSignIn(attacker, back.completion)).status, 400);
  });

  test("states are single use, expire, and are replaced by a newer attempt", async () => {
    const d = await t.install();
    const flow = await t.startSignIn(d);
    const first = await t.googleReturns(flow, alice);
    assert.equal(first.res.status, 303);
    const replay = await t.googleReturns(flow, alice);
    assert.equal(replay.res.status, 400, "the same state cannot be used twice");
    assert.match(replay.res.raw, /expired or was already used/);

    const stale = await t.startSignIn(d);
    await t.db.query("UPDATE auth_flows SET expires_at = now() - interval '1 minute' WHERE device_id = $1", [d.deviceId]);
    assert.equal((await t.googleReturns(stale, alice)).res.status, 400, "an expired state is refused");

    const older = await t.startSignIn(d);
    const newer = await t.startSignIn(d);
    assert.equal((await t.googleReturns(older, alice)).res.status, 400, "starting again abandons the previous attempt");
    const ok = await t.googleReturns(newer, alice);
    await t.db.query("UPDATE auth_flows SET expires_at = now() - interval '1 minute' WHERE device_id = $1", [d.deviceId]);
    assert.equal((await t.completeSignIn(d, ok.completion)).status, 400, "a completion code expires too");

    const junk = await t.call("GET", "/auth/google/callback?code=x&state=st_never-issued");
    assert.equal(junk.status, 400);
    assert.equal((await t.call("GET", "/auth/google/callback")).status, 400);
  });

  test("tokens that are not a fresh, verified sign-in for this app are refused", async () => {
    const d = await t.install();
    const before = (await t.db.query("SELECT count(*)::int AS n FROM users")).rows[0].n;
    const tryWith = async (claims) => {
      const flow = await t.startSignIn(d);
      const back = await t.googleReturns(flow, person("mallory"), { claims });
      assert.equal(back.res.status, 400, JSON.stringify(claims));
      assert.equal(back.completion, null);
      assert.match(back.res.headers["content-type"], /text\/html/);
      // The failed state is spent.
      assert.equal((await t.googleReturns(flow, person("mallory"))).res.status, 400);
    };
    await tryWith({ aud: "someone-else.apps.googleusercontent.com" });
    await tryWith({ iss: "https://accounts.evil.example" });
    await tryWith({ nonce: "not-ours" });
    await tryWith({ email_verified: false });
    await tryWith({ exp: Math.floor(Date.now() / 1000) - 3600 });
    await tryWith({ sub: "" });

    // A code Google does not recognize.
    const flow = await t.startSignIn(d);
    const bad = await t.call("GET", `/auth/google/callback?code=never-issued&state=${encodeURIComponent(flow.state)}`);
    assert.equal(bad.status, 400);
    assert.match(bad.raw, /Google did not accept the sign-in/);

    assert.equal((await t.db.query("SELECT count(*)::int AS n FROM users")).rows[0].n, before, "no accounts were created");
    assert.equal((await t.me(d)).body.account.user, null);
  });

  test("cancelling at Google shows a plain page, safely", async () => {
    const res = await t.call("GET", "/auth/google/callback?error=access_denied&state=whatever");
    assert.equal(res.status, 400);
    assert.match(res.raw, /cancelled the Google sign-in/);
    assert.match(res.headers["content-security-policy"], /default-src 'none'/);
    const done = await t.call("GET", "/auth/done");
    assert.equal(done.status, 200);
    assert.ok(!/<script/i.test(done.raw), "the done page runs no script");
    assert.equal((await t.call("GET", "/auth/style.css")).status, 200);
    const reflected = await t.call("GET", `/auth/google/callback?error=${encodeURIComponent("<script>alert(1)</script>")}`);
    assert.ok(!reflected.raw.includes("<script>alert(1)</script>"), "query input is never echoed into the page");
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
      assert.equal((await limited.startSignIn(d)).res.status, 200);
      assert.equal((await limited.startSignIn(d)).res.status, 200);
      const third = await limited.startSignIn(d);
      assert.equal(third.res.status, 429);
      assert.equal((await limited.startSignIn(await limited.install())).res.status, 200);
    } finally {
      await limited.close();
    }
  });

  test("starting and finishing need the install's own token", async () => {
    assert.equal((await t.call("POST", "/v1/auth/google/start")).status, 401);
    assert.equal((await t.call("POST", "/v1/auth/google/complete", { body: { code: "ac_0123456789" } })).status, 401);
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
      const start = await t.call("POST", "/v1/auth/google/start", { token: d.token });
      assert.equal(start.status, 404);
      assert.equal(start.body.error.code, "sign_in_unavailable");
      assert.equal((await t.call("GET", "/auth/google/callback?code=a&state=b")).status, 404);
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

  test("the callback works when the API is locked to the extension's origin", async () => {
    const t = await createTestApp({ ...GOOGLE, ALLOWED_ORIGINS: EXT_ORIGIN });
    try {
      const origin = { origin: EXT_ORIGIN };
      const reg = await t.call("POST", "/v1/devices", { body: { installId: "install-id-for-origin-test-0001" }, ip: nextIp(), headers: origin });
      const start = await t.call("POST", "/v1/auth/google/start", { token: reg.body.token, headers: origin });
      const url = new URL(start.body.url);
      t.fake.google.issue("c1", { nonce: url.searchParams.get("nonce"), account: person("fay") });
      // Google's redirect arrives from a normal browser tab: no extension origin.
      const back = await t.call("GET", `/auth/google/callback?code=c1&state=${encodeURIComponent(url.searchParams.get("state"))}`);
      assert.equal(back.status, 303);
      const completion = back.headers.location.split("#code=")[1];
      assert.equal((await t.call("POST", "/v1/auth/google/complete", { token: reg.body.token, body: { code: completion } })).status, 403, "finishing still needs the extension");
      const done = await t.call("POST", "/v1/auth/google/complete", { token: reg.body.token, body: { code: completion }, headers: origin });
      assert.equal(done.status, 200);
      assert.equal(done.body.account.user.email, "fay@example.com");
    } finally {
      await t.close();
    }
  });
});

/* -------------------------- licenses and accounts -------------------------- */

describe("licenses follow the account", () => {
  let t;
  before(async () => (t = await createTestApp(GOOGLE)));
  after(() => t.close());

  test("a key activated while signed in belongs to the account and follows it", async () => {
    const gina = person("gina");
    const lic = await t.license({ maxDevices: 2 });
    const laptop = await t.install();
    await t.signIn(laptop, gina);
    assert.equal((await t.activate(laptop, lic.key)).status, 200);
    const detail = await t.admin("GET", `/licenses/${lic.id}`);
    assert.equal(detail.body.license.owner.email, "gina@example.com");

    // A second browser: just sign in. No key.
    const desktop = await t.install();
    const signedIn = await t.signIn(desktop, gina);
    assert.equal(signedIn.body.account.licensed, true);
    assert.equal(signedIn.body.account.plan, "pro");
    assert.equal(signedIn.body.account.license.devicesUsed, 2);
    assert.equal((await t.generate(desktop)).status, 200);

    // A third browser: seats are full, so nothing is taken from anyone...
    const tablet = await t.install();
    const full = await t.signIn(tablet, gina);
    assert.equal(full.body.account.licensed, false);
    assert.deepEqual(
      { plan: full.body.account.accountLicense.plan, used: full.body.account.accountLicense.devicesUsed, max: full.body.account.accountLicense.maxDevices, reason: full.body.account.accountLicense.reason },
      { plan: "Pro", used: 2, max: 2, reason: "device_limit" },
    );
    // ...until the user asks to move it here.
    await t.db.query("UPDATE devices SET last_seen_at = now() - interval '9 days' WHERE id = $1", [laptop.deviceId]);
    const moved = await t.attach(tablet);
    assert.equal(moved.status, 200);
    assert.equal(moved.body.account.licensed, true);
    assert.equal(moved.body.account.accountLicense, null);
    assert.equal((await t.me(laptop)).body.account.licensed, false, "the browser idle longest gave up its seat");
    assert.equal((await t.me(desktop)).body.account.licensed, true);
  });

  test("a key entered before signing in is linked when the user signs in", async () => {
    const lic = await t.license();
    const d = await t.install();
    assert.equal((await t.activate(d, lic.key)).status, 200, "a key works without an account");
    assert.equal((await t.generate(d)).status, 200, "and licensed use never requires signing in");
    await t.signIn(d, person("hank"));
    assert.equal((await t.admin("GET", `/licenses/${lic.id}`)).body.license.owner.email, "hank@example.com");
    const other = await t.install();
    assert.equal((await t.signIn(other, person("hank"))).body.account.licensed, true);
  });

  test("a license issued to an email is there when that person signs up", async () => {
    const lic = await t.license({ email: "Ivy@Example.com", days: 30 });
    assert.equal(lic.owner, null, "nobody has that account yet");
    const d = await t.install();
    const res = await t.signIn(d, person("ivy"));
    assert.equal(res.body.account.licensed, true, "no key was ever typed");
    assert.equal(res.body.account.license.hint, lic.hint);
    assert.ok(res.body.account.license.expiresAt, "the 30 days started at this first use");
    assert.equal((await t.admin("GET", `/licenses/${lic.id}`)).body.license.owner.email, "ivy@example.com");
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

  test("another person's email does not claim a license", async () => {
    await t.license({ email: "kim@example.com" });
    const d = await t.install();
    const res = await t.signIn(d, person("not-kim"));
    assert.equal(res.body.account.licensed, false);
  });

  test("removing a license from a browser sticks until the user brings it back", async () => {
    const lee = person("lee");
    const lic = await t.license({ email: lee.email });
    const d = await t.install();
    assert.equal((await t.signIn(d, lee)).body.account.licensed, true);

    const off = await t.deactivate(d);
    assert.equal(off.body.account.licensed, false);
    assert.equal(off.body.account.accountLicense.reason, "detached");
    assert.equal((await t.me(d)).body.account.licensed, false, "it does not hop straight back");
    assert.equal((await t.generate(d)).body.account?.licensed ?? false, false);

    const back = await t.attach(d);
    assert.equal(back.status, 200);
    assert.equal(back.body.account.licensed, true);
    assert.equal(back.body.account.license.hint, lic.hint);
  });

  test("signing out takes the account's license with it, but not a key-only one", async () => {
    const max = person("max");
    await t.license({ email: max.email });
    const d = await t.install();
    await t.signIn(d, max);
    assert.equal((await t.me(d)).body.account.licensed, true);
    const out = await t.signOut(d);
    assert.equal(out.body.account.licensed, false);
    assert.equal(out.body.account.user, null);

    // A team key used by someone who is not its owner stays put on sign-out.
    const team = await t.license({ maxDevices: 3 });
    const owner = await t.install();
    await t.signIn(owner, person("team-owner"));
    await t.activate(owner, team.key);
    const member = await t.install();
    await t.signIn(member, person("team-member"));
    assert.equal((await t.activate(member, team.key)).status, 200, "a key still works for another account, within its seats");
    assert.equal((await t.admin("GET", `/licenses/${team.id}`)).body.license.owner.email, "team-owner@example.com");
    const memberOut = await t.signOut(member);
    assert.equal(memberOut.body.account.licensed, true, "the member's seat came from the key, not from their account");
  });

  test("attach needs a signed-in account that owns a license", async () => {
    const d = await t.install();
    const anon = await t.attach(d);
    assert.equal(anon.status, 403);
    assert.equal(anon.body.error.code, "sign_in_required");
    await t.signIn(d, person("nolicense"));
    const none = await t.attach(d);
    assert.equal(none.status, 404);
    assert.equal(none.body.error.code, "no_account_license");
  });

  test("a revoked or expired account license is not attached", async () => {
    const pat = person("pat");
    const lic = await t.license({ email: pat.email });
    await t.admin("PATCH", `/licenses/${lic.id}`, { status: "revoked" });
    const d = await t.install();
    assert.equal((await t.signIn(d, pat)).body.account.licensed, false);
    await t.admin("PATCH", `/licenses/${lic.id}`, { status: "active", expiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal((await t.me(d)).body.account.licensed, false);
    await t.admin("PATCH", `/licenses/${lic.id}`, { expiresAt: null });
    assert.equal((await t.me(d)).body.account.licensed, true, "and comes back once it is valid again");
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
    const flow = await t.startSignIn(fresh);
    const back = await t.googleReturns(flow, person("quinn"));
    const done = await t.completeSignIn(fresh, back.completion);
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

  test("deleting a user signs them out everywhere and erases their record", async () => {
    const sam = person("sam");
    const lic = await t.license({ email: sam.email });
    const d = await t.install();
    await t.signIn(d, sam);
    assert.equal((await t.me(d)).body.account.licensed, true);
    await t.license({ email: "unrelated@example.com" });
    const s = await find("sam@");

    const res = await t.admin("DELETE", `/users/${s.id}`);
    assert.equal(res.status, 200);
    assert.equal((await t.db.query("SELECT 1 FROM users WHERE id = $1", [s.id])).rows.length, 0);
    assert.equal((await t.db.query("SELECT 1 FROM trial_counters WHERE key = $1", [`user:${s.id}`])).rows.length, 0);
    const me = (await t.me(d)).body.account;
    assert.equal(me.user, null);
    assert.equal(me.licensed, false, "their license left the browser with the account");
    const kept = await t.admin("GET", `/licenses/${lic.id}`);
    assert.equal(kept.body.license.owner, null);
    assert.equal(kept.body.license.state, "active", "the license itself is not destroyed");
    assert.equal((await t.admin("DELETE", `/users/${s.id}`)).status, 404);
  });
});
