// In-memory token-bucket limiters.
//
// These guard against bursts and brute force. They live in process memory,
// which is exactly right for a single Railway service. If you ever run
// several replicas, each replica enforces its own bucket; the hard quotas
// (free allowance, daily, global caps) are in Postgres and stay exact regardless.

const MAX_KEYS = 200_000;

export function createLimiter({ limit, windowMs, now = Date.now }) {
  const buckets = new Map();
  const refillPerMs = limit / windowMs;

  function read(key) {
    const t = now();
    const b = buckets.get(key);
    if (!b) return { tokens: limit, at: t };
    const tokens = Math.min(limit, b.tokens + (t - b.at) * refillPerMs);
    return { tokens, at: t };
  }

  function retryAfterMs(tokens) {
    return Math.max(0, Math.ceil((1 - tokens) / refillPerMs));
  }

  // Drop buckets that have fully refilled. `force` also evicts the oldest
  // entries when the map is at capacity (key-flood protection).
  function sweep(force = false) {
    const t = now();
    for (const [key, b] of buckets) {
      if (b.tokens + (t - b.at) * refillPerMs >= limit) buckets.delete(key);
    }
    if (force && buckets.size >= MAX_KEYS) {
      let drop = Math.ceil(MAX_KEYS / 10);
      for (const key of buckets.keys()) {
        buckets.delete(key);
        if (--drop <= 0) break;
      }
    }
  }

  return {
    // Would a hit be allowed right now? Does not consume.
    check(key) {
      const b = read(key);
      return b.tokens >= 1 ? { ok: true, retryAfterMs: 0 } : { ok: false, retryAfterMs: retryAfterMs(b.tokens) };
    },
    // Consume one token if available.
    take(key) {
      const b = read(key);
      if (b.tokens < 1) return { ok: false, retryAfterMs: retryAfterMs(b.tokens) };
      b.tokens -= 1;
      if (buckets.size >= MAX_KEYS && !buckets.has(key)) sweep(true);
      buckets.set(key, b);
      return { ok: true, retryAfterMs: 0, remaining: Math.floor(b.tokens) };
    },
    reset(key) {
      buckets.delete(key);
    },
    sweep,
    get size() {
      return buckets.size;
    },
  };
}

// Tracks which devices have a generation in flight and when each last
// finished, to enforce "one at a time" and a short cooldown.
export function createActivityGate({ cooldownMs, now = Date.now }) {
  const inFlight = new Set();
  const lastDone = new Map();

  return {
    enter(deviceId) {
      if (inFlight.has(deviceId)) return { ok: false, code: "busy", retryAfterMs: 1000 };
      const last = lastDone.get(deviceId);
      if (cooldownMs && last !== undefined) {
        const wait = cooldownMs - (now() - last);
        if (wait > 0) return { ok: false, code: "cooldown", retryAfterMs: wait };
      }
      inFlight.add(deviceId);
      return { ok: true };
    },
    leave(deviceId, { countCooldown = true } = {}) {
      inFlight.delete(deviceId);
      if (countCooldown) lastDone.set(deviceId, now());
    },
    sweep() {
      const cutoff = now() - Math.max(cooldownMs, 60_000);
      for (const [id, t] of lastDone) if (t < cutoff) lastDone.delete(id);
    },
  };
}
