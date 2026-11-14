// The account view for a device.

import { getDevice } from "./devices.js";
import { attachAccountLicense, peekAccountLicense } from "./licenses.js";
import { buildAccount } from "./quota.js";

// Returns { device, account, waiting }.
//
// attach: false  describe only. Nothing is written, so this is what GET
//                requests use. A license the account could have here is
//                reported in account.accountLicense.
// attach: true   also give a signed-in browser its account's license when a
//                seat is free. `device` may then be a fresh row, so callers
//                that go on to use it must take it from the result.
export async function resolveAccount(db, config, { device, ipHash, xhHash = null, now = Date.now(), attach = false, log = null }) {
  let current = device;
  let waiting = null;
  if (current.user) {
    try {
      if (attach) {
        const result = await attachAccountLicense(db, config, { device: current, ipHash });
        waiting = result.waiting;
        if (result.attached) current = (await getDevice(db, current.id)) || current;
      } else {
        waiting = await peekAccountLicense(db, config, current);
      }
    } catch (err) {
      // Never let a problem with a license hide the account itself.
      log?.warn({ err }, "could not resolve the account's license");
    }
  }
  const account = await buildAccount(db, config, { device: current, ipHash, xhHash, now, waiting });
  return { device: current, account, waiting };
}
