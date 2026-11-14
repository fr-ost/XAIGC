// Sign in with Google, from inside the extension.
//
//   POST /v1/auth/google   (extension: its device token + a Google access token)
//
// The extension gets the access token from Chrome (chrome.identity), which
// shows Chrome's own account prompt. No tab is opened and this server serves
// no sign-in pages. The token is checked with Google (see services/google.js):
// it must have been issued to this product's own OAuth client, and Google
// must vouch for the account's email address.
//
// The sign-in applies to the install that presents the token, and to no
// other: the request is authenticated with that install's device token.

import { ApiError, errors } from "../errors.js";
import { hmac } from "../services/crypto.js";
import { getDevice } from "../services/devices.js";
import { GoogleAuthError, verifyAccessToken } from "../services/google.js";
import { resolveAccount } from "../services/session.js";
import { signInDevice, signOutDevice, upsertGoogleUser } from "../services/users.js";

export async function registerAuthRoutes(app, { config, db, limiters, clock, requireDevice, fetchImpl }) {
  app.post(
    "/v1/auth/google",
    {
      preValidation: requireDevice,
      schema: {
        body: {
          type: "object",
          required: ["accessToken"],
          additionalProperties: false,
          properties: { accessToken: { type: "string", minLength: 20, maxLength: 4096 } },
        },
      },
    },
    async (req) => {
      if (!config.google.enabled) throw new ApiError(404, "sign_in_unavailable", "Google sign-in is not set up on this server.");
      const device = req.device;
      const hit = limiters.signInStart.take(device.id);
      if (!hit.ok) throw errors.tooMany("rate_limited", "Too many sign-in attempts. Wait a few minutes and try again.", hit.retryAfterMs);

      let identity;
      try {
        identity = await verifyAccessToken(config, req.body.accessToken, { fetchImpl, now: clock() });
      } catch (err) {
        if (!(err instanceof GoogleAuthError)) throw err;
        req.log.warn({ code: err.code }, "google sign-in failed");
        if (err.code === "unreachable") throw errors.upstream("google_unreachable", err.message, 503);
        // 400, not 401: a 401 tells the extension its own device token is bad.
        throw errors.badRequest(err.message, "google_token_rejected");
      }

      // The trial counter hangs off a keyed hash of the Google id, so it
      // survives the account being deleted and created again.
      const user = await upsertGoogleUser(db, identity, hmac(config.appSecret, `gsub:${identity.sub}`));
      if (user.blocked) throw errors.forbidden("account_blocked", "This account has been blocked. Contact support.");
      // Signing in changes who this browser belongs to and nothing else. In
      // particular it does not make the account the owner of a license that
      // happens to be active here.
      await signInDevice(db, device, user, { ipHash: req.net.hash });

      const fresh = await getDevice(db, device.id);
      const { account } = await resolveAccount(db, config, { device: fresh, ipHash: req.net.hash, now: clock(), attach: true, log: req.log });
      return { ok: true, created: Boolean(user.created), account };
    },
  );

  app.post("/v1/auth/signout", { preValidation: requireDevice }, async (req) => {
    await signOutDevice(db, req.device, { ipHash: req.net.hash });
    const fresh = await getDevice(db, req.device.id);
    const { account } = await resolveAccount(db, config, { device: fresh, ipHash: req.net.hash, now: clock(), log: req.log });
    return { ok: true, account };
  });
}
