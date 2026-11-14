// Device registration, account status and license activation.

import { ApiError, errors } from "../errors.js";
import { authenticateDevice, getDevice, registerDevice, touchDevice } from "../services/devices.js";
import { activateLicense, attachAccountLicense, deactivateDevice, licenseState } from "../services/licenses.js";
import { buildAccount } from "../services/quota.js";
import { resolveAccount } from "../services/session.js";

const clientVersion = (req) => String(req.headers["x-xaigc-client"] || "").slice(0, 20) || null;
const licenseStateOf = (device) => licenseState(device.license);

export function registerPublicRoutes(app, { config, db, limiters, clock, requireDevice }) {
  // First contact from a fresh install. Returns the device's bearer token.
  app.post(
    "/v1/devices",
    {
      schema: {
        body: {
          type: "object",
          required: ["installId"],
          additionalProperties: false,
          properties: {
            installId: { type: "string", minLength: 20, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" },
          },
        },
      },
    },
    async (req) => {
      const hit = limiters.register.take(req.net.group);
      if (!hit.ok) throw errors.tooMany("rate_limited", "Too many installs from this network. Try again later.", hit.retryAfterMs);

      const { device, token } = await registerDevice(db, config, {
        installId: req.body.installId,
        clientVersion: clientVersion(req),
        ipHash: req.net.hash,
        now: clock(),
      });
      const full = await authenticateDevice(db, token);
      const account = await buildAccount(db, config, { device: full, ipHash: req.net.hash, now: clock() });
      return { token, deviceId: device.id, account };
    },
  );

  app.get("/v1/me", { preValidation: requireDevice }, async (req) => {
    const device = req.device;
    if (clock() - new Date(device.last_seen_at).getTime() > 10 * 60_000) {
      await touchDevice(db, device.id, { ipHash: req.net.hash, clientVersion: clientVersion(req) });
    }
    // A signed-in browser picks up its account's license here, so a license
    // issued or granted while the user was away shows up on their next look.
    const { account } = await resolveAccount(db, config, { device, ipHash: req.net.hash, now: clock(), log: req.log });
    return { deviceId: device.id, account };
  });

  app.post(
    "/v1/license/activate",
    {
      preValidation: requireDevice,
      schema: {
        body: {
          type: "object",
          required: ["key"],
          additionalProperties: false,
          properties: {
            key: { type: "string", minLength: 1, maxLength: 80 },
            replaceOldest: { type: "boolean" },
          },
        },
      },
    },
    async (req) => {
      const device = req.device;
      try {
        await activateLicense(db, config, {
          device,
          rawKey: req.body.key,
          replaceOldest: req.body.replaceOldest === true,
          ipHash: req.net.hash,
        });
      } catch (err) {
        // Wrong keys are counted per network and per install, and past the
        // allowance the answer becomes "slow down". The key is always checked
        // first, so a correct key gets through no matter how many wrong ones
        // came before it: nobody can lock a paying customer out by spamming
        // bad keys from the same network. Guessing stays hopeless either way
        // (100-bit keys against a few attempts a minute).
        if (err instanceof ApiError && err.code === "invalid_key") {
          const misses = [`ip:${req.net.group}`, `dev:${device.id}`].map((bucket) => limiters.activateFail.take(bucket));
          const blocked = misses.find((m) => !m.ok);
          if (blocked) {
            throw errors.tooMany("too_many_attempts", "Too many incorrect keys. Wait a few minutes and try again.", blocked.retryAfterMs);
          }
        }
        throw err;
      }

      const fresh = await getDevice(db, device.id);
      return { ok: true, account: await buildAccount(db, config, { device: fresh, ipHash: req.net.hash, now: clock() }) };
    },
  );

  // Move the signed-in account's license to this browser, signing out the
  // browser that has been idle longest if every seat is taken. No key needed:
  // the account owns the license.
  app.post("/v1/license/attach", { preValidation: requireDevice }, async (req) => {
    const device = req.device;
    if (!device.user) throw errors.forbidden("sign_in_required", "Sign in with Google first.");
    const { attached, waiting } = await attachAccountLicense(db, config, { device, explicit: true, ipHash: req.net.hash });
    if (!attached && waiting?.error) throw waiting.error;
    if (!attached && licenseStateOf(device) !== "active") {
      throw new ApiError(404, "no_account_license", "This account does not have an active license.");
    }
    const fresh = await getDevice(db, device.id);
    return { ok: true, account: await buildAccount(db, config, { device: fresh, ipHash: req.net.hash, now: clock() }) };
  });

  app.post("/v1/license/deactivate", { preValidation: requireDevice }, async (req) => {
    await deactivateDevice(db, { device: req.device, ipHash: req.net.hash });
    // Removing a license also switches off automatic re-attachment for this
    // browser, so an account-owned license stays off until the user asks for it.
    const fresh = await getDevice(db, req.device.id);
    const { account } = await resolveAccount(db, config, { device: fresh, ipHash: req.net.hash, now: clock(), log: req.log });
    return { ok: true, account };
  });
}
