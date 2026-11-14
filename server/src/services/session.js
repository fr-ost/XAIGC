// The account view for a device: give a signed-in browser its account's
// license when it has none, then describe the result.

import { getDevice } from "./devices.js";
import { attachAccountLicense } from "./licenses.js";
import { buildAccount } from "./quota.js";

// Returns { device, account }. `device` may be a fresh row (when a license
// was just attached), so callers that go on to use it must take it from here.
export async function resolveAccount(db, config, { device, ipHash, xhHash = null, now = Date.now(), log = null }) {
  let current = device;
  let waiting = null;
  if (current.user) {
    try {
      const result = await attachAccountLicense(db, config, { device: current, ipHash });
      waiting = result.waiting;
      if (result.attached) current = (await getDevice(db, current.id)) || current;
    } catch (err) {
      // Never let a problem attaching a license hide the account itself.
      log?.warn({ err }, "could not attach the account's license");
    }
  }
  const account = await buildAccount(db, config, { device: current, ipHash, xhHash, now, waiting });
  return { device: current, account };
}
