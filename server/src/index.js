// XAICG server entry point.
// A product of Unique Labs (https://uniquelabs.org). Developed by Shahriar Ahmed.

import { loadConfig } from "./config.js";
import { createDb, migrate, waitForDatabase } from "./db/index.js";
import { buildApp } from "./app.js";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const bootLog = {
    info: (obj, msg) => console.log(JSON.stringify({ level: "info", msg: msg || obj, ...(msg ? obj : {}) })),
    warn: (obj, msg) => console.warn(JSON.stringify({ level: "warn", msg: msg || obj, ...(msg ? obj : {}) })),
    error: (obj, msg) => console.error(JSON.stringify({ level: "error", msg: msg || obj, ...(msg ? obj : {}) })),
    debug: () => {},
  };

  const db = await createDb(config, bootLog);
  await waitForDatabase(db, { logger: bootLog });
  await migrate(db, bootLog);

  if (config.production && !config.clientIpHeader && !config.trustProxy) {
    bootLog.warn(
      "CLIENT_IP_HEADER is not set and this does not look like Railway: client addresses are read from the socket. " +
        "Behind a proxy that is the proxy itself, so every user would share one rate-limit bucket. " +
        "Set CLIENT_IP_HEADER to the header your platform overwrites with the caller's address.",
    );
  }

  const app = await buildApp({ config, db });

  // Rows from earlier versions, which logged each server generation, age out.
  const prune = async () => {
    try {
      await db.query("DELETE FROM usage_events WHERE ts < now() - make_interval(days => $1)", [config.usageEventRetentionDays]);
    } catch (err) {
      app.log.warn({ err }, "usage event pruning failed");
    }
  };
  prune();
  const pruner = setInterval(prune, 6 * 60 * 60 * 1000);
  pruner.unref();

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "shutting down");
    clearInterval(pruner);
    try {
      await app.close();
      await db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await app.listen({ port: config.port, host: config.host });
  for (const notice of config.notices) app.log.warn(notice);
  app.log.info(
    { version: config.version, database: db.kind, admin: Boolean(config.adminToken) },
    "XAICG server ready",
  );
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
