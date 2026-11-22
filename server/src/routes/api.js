// The extension's two calls: "this install exists" and "a draft was written".

import { errors } from "../errors.js";
import { countDraft, KINDS, registerDevice } from "../services/devices.js";

const clientVersion = (req) => String(req.headers["x-xaigc-client"] || "").slice(0, 20) || null;

export function registerApiRoutes(app, { config, db, limiters, clock, requireDevice }) {
  // First contact from a fresh install. Returns the install's bearer token.
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
      const { device, token, created } = await registerDevice(db, config, {
        installId: req.body.installId,
        clientVersion: clientVersion(req),
        ipHash: req.net.hash,
        now: clock(),
      });
      return { token, deviceId: device.id, created };
    },
  );

  // One draft of this kind was written on the user's computer.
  app.post(
    "/v1/usage",
    {
      preValidation: requireDevice,
      schema: {
        body: {
          type: "object",
          required: ["kind"],
          additionalProperties: false,
          properties: { kind: { type: "string", enum: KINDS } },
        },
      },
    },
    async (req) => {
      const hit = limiters.drafts.take(req.device.id);
      if (!hit.ok) throw errors.tooMany("rate_limited", "Too many reports. Slow down a little.", hit.retryAfterMs);
      const counted = await countDraft(db, config, { device: req.device, kind: req.body.kind, clientVersion: clientVersion(req), now: clock() });
      return { ok: true, counted };
    },
  );
}
