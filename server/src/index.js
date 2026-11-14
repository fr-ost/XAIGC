// XAIGC server entry point.
// A product of Unique Labs (https://uniquelabs.org). Developed by Shahriar Ahmed.

import { loadConfig } from "./config.js";
import { createDb, migrate } from "./db/index.js";
import { createOpenAI } from "./engine/openai.js";
import { createEngine } from "./engine/index.js";
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
  await migrate(db, bootLog);

  const openai = createOpenAI(config, { logger: bootLog });
  if (!config.openai.apiKey) {
    bootLog.warn("OPENAI_API_KEY is not set: generation requests will fail until it is.");
  } else if (config.openai.verifyModelOnBoot) {
    // Refuse to start on a definite misconfiguration, so a bad deploy never
    // replaces a healthy one.
    await openai.verifyModel();
  }

  const engine = createEngine(config, { openai, logger: bootLog });
  const app = await buildApp({ config, db, engine });

  // Keep the events table bounded.
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
  app.log.info(
    { version: config.version, database: db.kind, model: config.openai.model, admin: Boolean(config.adminToken) },
    "XAIGC server ready",
  );
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
