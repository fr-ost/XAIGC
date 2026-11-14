// Device registration, account status and license activation.

import { ApiError, errors } from "../errors.js";
import { authenticateDevice, registerDevice, touchDevice } from "../services/devices.js";
import { activateLicense, deactivateDevice } from "../services/licenses.js";
import { buildAccount } from "../services/quota.js";

const clientVersion = (req) => String(req.headers["x-xaigc-client"] || "").slice(0, 20) || null;

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
    return { deviceId: device.id, account: await buildAccount(db, config, { device, ipHash: req.net.hash, now: clock() }) };
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
      const buckets = [`ip:${req.net.group}`, `dev:${device.id}`];

      // Wrong keys are counted per network and per device. After a handful
      // of misses both are locked out, which makes guessing keys hopeless.
      for (const bucket of buckets) {
        const state = limiters.activateFail.check(bucket);
        if (!state.ok) {
          throw errors.tooMany("too_many_attempts", "Too many incorrect keys. Wait a few minutes and try again.", state.retryAfterMs);
        }
      }

      try {
        await activateLicense(db, config, {
          device,
          rawKey: req.body.key,
          replaceOldest: req.body.replaceOldest === true,
          ipHash: req.net.hash,
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === "invalid_key") {
          for (const bucket of buckets) limiters.activateFail.take(bucket);
        }
        throw err;
      }

      const fresh = await authenticateDevice(db, req.headers.authorization.replace(/^Bearer\s+/i, ""));
      return { ok: true, account: await buildAccount(db, config, { device: fresh, ipHash: req.net.hash, now: clock() }) };
    },
  );

  app.post("/v1/license/deactivate", { preValidation: requireDevice }, async (req) => {
    await deactivateDevice(db, { device: req.device, ipHash: req.net.hash });
    const fresh = { ...req.device, license_id: null, license: null };
    return { ok: true, account: await buildAccount(db, config, { device: fresh, ipHash: req.net.hash, now: clock() }) };
  });
}
