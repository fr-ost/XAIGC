// Database layer.
//
// Production uses Postgres through `pg` (DATABASE_URL, e.g. the Railway
// Postgres plugin). When DATABASE_URL is not set outside production, the
// server falls back to PGlite, a real Postgres engine compiled to WASM, so
// `npm run dev` and `npm test` need no database install.
//
// Both adapters expose the same tiny surface:
//   query(text, params) -> { rows }
//   exec(sql)           -> run a multi-statement script
//   tx(fn)              -> run fn({ query, exec }) inside a transaction
//   close()

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const MIGRATION_LOCK_ID = 7274203;

function sslOption(config) {
  const mode = config.databaseSsl;
  if (config.databaseSslCa) return { ca: config.databaseSslCa, rejectUnauthorized: true };
  if (mode === "true" || mode === "require") return { rejectUnauthorized: true };
  if (mode === "no-verify") return { rejectUnauthorized: false };
  return undefined; // defer to the connection string (Railway's private network uses none)
}

// node-postgres lets TLS parameters in the connection string override the
// `ssl` option, so "?sslmode=..." pasted along with a hosted database's URL
// would silently replace DATABASE_SSL / DATABASE_SSL_CA (even downgrade a
// pinned certificate to no verification). When TLS is configured explicitly,
// those parameters are removed from the URL so the explicit setting applies.
export function connectionStringFor(config) {
  if (!sslOption(config)) return config.databaseUrl;
  try {
    const url = new URL(config.databaseUrl);
    for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return config.databaseUrl;
  }
}

async function createPgDb(config, logger) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: connectionStringFor(config),
    ssl: sslOption(config),
    max: config.databasePoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (err) => logger?.error({ err }, "postgres pool error"));

  const wrap = (client) => ({
    query: async (text, params) => {
      const res = await client.query(text, params);
      return { rows: res.rows };
    },
    exec: async (sql) => {
      await client.query(sql);
    },
  });

  return {
    kind: "postgres",
    ...wrap(pool),
    // Transaction callbacks must be safe to run again: on a deadlock or
    // serialization failure Postgres rolls the attempt back and it is retried.
    async tx(fn) {
      for (let attempt = 1; ; attempt++) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn(wrap(client));
          await client.query("COMMIT");
          return result;
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* connection already broken */
          }
          const retryable = err?.code === "40P01" || err?.code === "40001";
          if (!retryable || attempt >= 3) throw err;
          logger?.warn({ code: err.code, attempt }, "transaction conflict, retrying");
          await new Promise((resolve) => setTimeout(resolve, 15 * attempt + Math.random() * 25));
        } finally {
          client.release();
        }
      }
    },
    close: () => pool.end(),
  };
}

async function createPgliteDb(config) {
  let PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    throw new Error(
      "DATABASE_URL is not set and the embedded dev database (@electric-sql/pglite) is not installed. " +
        "Set DATABASE_URL, or run `npm install` without --omit=dev.",
    );
  }
  const pglite = new PGlite(config.pgliteDir || undefined);
  await pglite.waitReady;

  const wrap = (target) => ({
    query: async (text, params) => {
      const res = await target.query(text, params);
      return { rows: res.rows };
    },
    exec: async (sql) => {
      await target.exec(sql);
    },
  });

  return {
    kind: "pglite",
    ...wrap(pglite),
    tx: (fn) => pglite.transaction((t) => fn(wrap(t))),
    close: () => pglite.close(),
  };
}

export async function migrate(db, logger) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    await db.tx(async (t) => {
      // Serialize concurrent boots (two replicas starting at once).
      await t.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_ID]);
      const done = await t.query("SELECT 1 FROM schema_migrations WHERE id = $1", [id]);
      if (done.rows.length) return;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await t.exec(sql);
      await t.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
      logger?.info({ migration: id }, "applied migration");
    });
  }
}

export async function createDb(config, logger) {
  if (config.databaseUrl) return createPgDb(config, logger);
  if (config.production) throw new Error("DATABASE_URL is required in production.");
  logger?.warn("DATABASE_URL not set: using the embedded PGlite dev database. Do not use this in production.");
  return createPgliteDb(config);
}

// Numeric columns come back as number, string (pg bigint) or BigInt (PGlite)
// depending on the adapter. Normalize at the edge.
export function num(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
