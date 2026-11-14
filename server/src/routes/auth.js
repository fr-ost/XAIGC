// Sign in with Google.
//
//   1. POST /v1/auth/google/start     (extension, with its device token)
//        -> the Google URL to open, carrying a one-time `state`
//   2. GET  /auth/google/callback     (the browser, sent back by Google)
//        -> the server swaps Google's code for the verified identity, parks
//           it on the sign-in, and redirects to /auth/done#code=...
//   3. POST /v1/auth/google/complete  (extension, device token + that code)
//        -> the account is created or found, and this browser is signed in
//
// Step 3 is what makes this safe. The browser that finishes at Google only
// ever receives a completion code in its own address bar; the sign-in takes
// effect when the install that STARTED it presents that code together with
// its device token. Sending someone a sign-in link therefore achieves
// nothing: their browser ends up holding a code that only the sender's
// install could use, and the sender never sees it.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ApiError, errors } from "../errors.js";
import { randomToken, sha256 } from "../services/crypto.js";
import { getDevice } from "../services/devices.js";
import { exchangeCode, googleAuthUrl, GoogleAuthError } from "../services/google.js";
import { resolveAccount } from "../services/session.js";
import { signOutDevice, upsertGoogleUser } from "../services/users.js";

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "auth-ui");
const PAGE_CSP = "default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const FLOW_MINUTES = 10;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function page({ title, heading, body, tone = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/auth/style.css">
</head>
<body>
<main class="card ${tone}">
<div class="logo" aria-hidden="true">X</div>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(body)}</p>
</main>
<footer>XAIGC · A product of <a href="https://uniquelabs.org" rel="noopener">Unique Labs</a> · Developed by Shahriar Ahmed</footer>
</body>
</html>`;
}

export async function registerAuthRoutes(app, { config, db, limiters, clock, requireDevice, fetchImpl }) {
  const css = await readFile(path.join(UI_DIR, "style.css"));
  const html = (reply, status, content) =>
    reply.code(status).header("Content-Security-Policy", PAGE_CSP).type("text/html; charset=utf-8").send(page(content));
  const failed = (reply, status, body) => html(reply, status, { title: "XAIGC sign-in", heading: "Sign-in didn't finish", body, tone: "bad" });

  app.get("/auth/style.css", async (req, reply) => {
    reply.header("Cache-Control", "public, max-age=3600").type("text/css; charset=utf-8");
    return css;
  });

  // Where the browser lands after a successful callback. The completion code
  // is in the URL fragment, which browsers never send to any server and which
  // therefore never appears in a log. The extension reads it from the tab,
  // finishes the sign-in and closes the tab.
  app.get("/auth/done", async (req, reply) =>
    html(reply, 200, {
      title: "XAIGC sign-in",
      heading: "Finishing sign-in",
      body: "You can close this tab and go back to XAIGC. If nothing happened, open the XAIGC settings page and choose Sign in with Google again.",
    }),
  );

  if (!config.google.enabled) {
    const unavailable = async () => {
      throw new ApiError(404, "sign_in_unavailable", "Google sign-in is not set up on this server.");
    };
    app.post("/v1/auth/google/start", { preValidation: requireDevice }, unavailable);
    app.post("/v1/auth/google/complete", { preValidation: requireDevice }, unavailable);
  } else {
    app.post("/v1/auth/google/start", { preValidation: requireDevice }, async (req) => {
      const device = req.device;
      const hit = limiters.signInStart.take(device.id);
      if (!hit.ok) throw errors.tooMany("rate_limited", "Too many sign-in attempts. Wait a few minutes and try again.", hit.retryAfterMs);

      const state = randomToken("st");
      const nonce = randomToken("n", 16);
      // One sign-in at a time per install; starting again abandons the last.
      await db.query("DELETE FROM auth_flows WHERE device_id = $1 OR expires_at < now()", [device.id]);
      await db.query(
        "INSERT INTO auth_flows (state_hash, device_id, nonce, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))",
        [sha256(state), device.id, nonce, FLOW_MINUTES],
      );
      return { url: googleAuthUrl(config, { state, nonce }) };
    });

    app.get(
      "/auth/google/callback",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              code: { type: "string", maxLength: 2048 },
              state: { type: "string", maxLength: 200 },
              error: { type: "string", maxLength: 200 },
            },
          },
        },
      },
      async (req, reply) => {
        const { code, state, error } = req.query;
        if (error) {
          return failed(reply, 400, error === "access_denied" ? "You cancelled the Google sign-in. Go back to XAIGC to try again." : "Google reported a problem. Go back to XAIGC and try again.");
        }
        if (!code || !state) return failed(reply, 400, "This sign-in link is incomplete. Go back to XAIGC and try again.");

        const stateHash = sha256(state);
        const flow = await db.query(
          "SELECT nonce FROM auth_flows WHERE state_hash = $1 AND code_hash IS NULL AND expires_at > now()",
          [stateHash],
        );
        if (!flow.rows[0]) return failed(reply, 400, "This sign-in link has expired or was already used. Go back to XAIGC and try again.");

        let identity;
        try {
          identity = await exchangeCode(config, code, { nonce: flow.rows[0].nonce, fetchImpl, now: clock() });
        } catch (err) {
          if (!(err instanceof GoogleAuthError)) throw err;
          req.log.warn({ code: err.code }, "google sign-in failed");
          // The state is spent either way: Google's code cannot be replayed.
          await db.query("DELETE FROM auth_flows WHERE state_hash = $1", [stateHash]);
          return failed(reply, 400, `${err.message} Go back to XAIGC and try again.`);
        }

        const completion = randomToken("ac");
        const parked = await db.query(
          "UPDATE auth_flows SET code_hash = $1, identity = $2 WHERE state_hash = $3 AND code_hash IS NULL AND expires_at > now() RETURNING device_id",
          [sha256(completion), JSON.stringify(identity), stateHash],
        );
        if (!parked.rows[0]) return failed(reply, 400, "This sign-in link has expired or was already used. Go back to XAIGC and try again.");
        return reply.redirect(`/auth/done#code=${completion}`, 303);
      },
    );

    app.post(
      "/v1/auth/google/complete",
      {
        preValidation: requireDevice,
        schema: {
          body: {
            type: "object",
            required: ["code"],
            additionalProperties: false,
            properties: { code: { type: "string", minLength: 10, maxLength: 200 } },
          },
        },
      },
      async (req) => {
        const device = req.device;
        // Single use, and only for the install that started this sign-in.
        const flow = await db.query(
          "DELETE FROM auth_flows WHERE code_hash = $1 AND device_id = $2 AND expires_at > now() RETURNING identity",
          [sha256(req.body.code), device.id],
        );
        const identity = flow.rows[0]?.identity;
        if (!identity) throw errors.badRequest("That sign-in has expired or was started in another browser. Try again.", "sign_in_expired");

        const user = await upsertGoogleUser(db, identity);
        if (user.blocked) throw errors.forbidden("account_blocked", "This account has been blocked. Contact support.");
        await db.query("UPDATE devices SET user_id = $1, auto_attach = true WHERE id = $2", [user.id, device.id]);
        // A key that was activated on this browser before signing in now
        // belongs to the account, so it follows the user to other browsers.
        if (device.license_id) {
          await db.query("UPDATE licenses SET user_id = $1, updated_at = now() WHERE id = $2 AND user_id IS NULL AND status = 'active'", [
            user.id,
            device.license_id,
          ]);
        }

        const fresh = await getDevice(db, device.id);
        const { account } = await resolveAccount(db, config, { device: fresh, ipHash: req.net.hash, now: clock(), log: req.log });
        return { ok: true, created: Boolean(user.created), account };
      },
    );
  }

  app.post("/v1/auth/signout", { preValidation: requireDevice }, async (req) => {
    await signOutDevice(db, req.device, { ipHash: req.net.hash });
    const fresh = await getDevice(db, req.device.id);
    const { account } = await resolveAccount(db, config, { device: fresh, ipHash: req.net.hash, now: clock(), log: req.log });
    return { ok: true, account };
  });
}
