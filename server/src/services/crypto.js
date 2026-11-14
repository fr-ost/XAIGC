import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function hmac(secret, value) {
  return createHmac("sha256", String(secret)).update(String(value)).digest("hex");
}

export function randomToken(prefix, bytes = 32) {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

export function safeEqual(a, b) {
  const x = Buffer.from(sha256(a), "hex");
  const y = Buffer.from(sha256(b), "hex");
  return timingSafeEqual(x, y);
}

// Reduce an address to the unit one subscriber controls: the full IPv4
// address, or the /64 prefix for IPv6 (a single connection owns 2^64 v6
// addresses, so limiting per address would be meaningless).
export function ipGroup(ip) {
  let addr = String(ip || "").trim().toLowerCase();
  if (!addr) return "unknown";
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  if (!addr.includes(":")) return addr;

  const [head, tail] = addr.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined && tail !== "" ? tail.split(":") : [];
  let groups;
  if (addr.includes("::")) {
    const missing = Math.max(0, 8 - headParts.length - tailParts.length);
    groups = [...headParts, ...Array(missing).fill("0"), ...tailParts];
  } else {
    groups = headParts;
  }
  const prefix = groups.slice(0, 4).map((g) => (g || "0").replace(/^0+(?=.)/, ""));
  while (prefix.length < 4) prefix.push("0");
  return prefix.join(":") + "::/64";
}
