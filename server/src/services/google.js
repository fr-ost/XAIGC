// Google sign-in: OAuth 2.0 authorization code flow, run by the server.
//
// The extension never sees a Google token. It opens the URL built here; Google
// sends the browser back to this server's callback with a one-time code; the
// server swaps that code for an ID token over a direct, authenticated HTTPS
// call to Google and reads the account's id and email from it.
//
// Because the ID token arrives straight from Google's token endpoint in
// answer to a request that carried the client secret, Google's guidance is
// that its signature need not be checked again. Its claims are still checked:
// issuer, audience, expiry, the nonce this server generated, and that Google
// has verified the email address.

export class GoogleAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}

const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export const redirectUri = (config) => `${config.publicUrl}/auth/google/callback`;

export function googleAuthUrl(config, { state, nonce }) {
  const url = new URL(config.google.authUrl);
  url.search = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(config),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account",
  }).toString();
  return url.toString();
}

function decodeIdToken(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new GoogleAuthError("bad_token", "Google returned an unreadable sign-in token.");
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new GoogleAuthError("bad_token", "Google returned an unreadable sign-in token.");
  }
}

// -> { sub, email, name }
export function validateClaims(config, claims, { nonce, now = Date.now() }) {
  if (!claims || typeof claims !== "object") throw new GoogleAuthError("bad_token", "Google returned an unreadable sign-in token.");
  if (!ISSUERS.has(claims.iss)) throw new GoogleAuthError("bad_issuer", "The sign-in token did not come from Google.");
  if (claims.aud !== config.google.clientId) throw new GoogleAuthError("bad_audience", "The sign-in token was issued for a different app.");
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) * 1000 < now - 60_000) {
    throw new GoogleAuthError("expired", "The sign-in token has expired. Try again.");
  }
  if (!nonce || claims.nonce !== nonce) throw new GoogleAuthError("bad_nonce", "The sign-in token does not match this sign-in attempt.");
  if (typeof claims.sub !== "string" || !claims.sub) throw new GoogleAuthError("bad_token", "Google did not say which account signed in.");
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email || email.length > 254) throw new GoogleAuthError("no_email", "That Google account has no email address to sign in with.");
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    throw new GoogleAuthError("email_unverified", "That Google account's email address is not verified.");
  }
  return {
    sub: claims.sub.slice(0, 255),
    email,
    name: typeof claims.name === "string" ? claims.name.trim().slice(0, 120) || null : null,
  };
}

// Swap the one-time authorization code for the account's verified identity.
export async function exchangeCode(config, code, { nonce, fetchImpl = globalThis.fetch, now = Date.now() }) {
  let res;
  try {
    res = await fetchImpl(config.google.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: redirectUri(config),
        grant_type: "authorization_code",
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GoogleAuthError("unreachable", "Couldn't reach Google to finish signing in. Try again.");
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok || !json?.id_token) {
    const detail = json?.error_description || json?.error || `HTTP ${res.status}`;
    throw new GoogleAuthError("exchange_failed", `Google did not accept the sign-in (${detail}).`);
  }
  return validateClaims(config, decodeIdToken(json.id_token), { nonce, now });
}
