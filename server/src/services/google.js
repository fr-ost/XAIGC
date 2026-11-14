// Google sign-in, done inside the extension.
//
// The extension asks Chrome for a Google access token (chrome.identity), so
// the person signs in with Chrome's own account prompt: no tab is opened and
// no web page of ours is involved. The extension sends that token here once,
// and this module turns it into a verified identity with two calls to Google:
//
//   tokeninfo  says which app the token was issued to. It must be this
//              product's own OAuth client. Without this check, a token that
//              some other app obtained for a person could be replayed here
//              to sign in as them.
//   userinfo   says whose token it is: the account id, the email address and
//              whether Google has verified it, and the name.
//
// The token is used for those two calls and then dropped. It is never stored
// or logged, and no client secret exists: an extension cannot keep one.

export class GoogleAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}

const REJECTED = "Google did not accept that sign-in. Try again.";

// Is this token ours, and still valid? `info` is Google's tokeninfo answer.
export function checkTokenInfo(config, info, { now = Date.now() } = {}) {
  if (!info || typeof info !== "object") throw new GoogleAuthError("bad_token", REJECTED);
  const ours = config.google.clientIds;
  if (typeof info.aud !== "string" || !ours.includes(info.aud)) {
    throw new GoogleAuthError("bad_audience", "That Google sign-in was issued for a different app.");
  }
  if (info.azp !== undefined && !ours.includes(info.azp)) {
    throw new GoogleAuthError("bad_audience", "That Google sign-in was issued for a different app.");
  }
  if (!Number.isFinite(Number(info.exp)) || Number(info.exp) * 1000 <= now) {
    throw new GoogleAuthError("expired", "That Google sign-in has expired. Try again.");
  }
  return info;
}

// -> { sub, email, name }. `profile` is Google's userinfo answer.
export function readProfile(profile, info = {}) {
  if (!profile || typeof profile !== "object") throw new GoogleAuthError("bad_token", REJECTED);
  if (typeof profile.sub !== "string" || !profile.sub) throw new GoogleAuthError("bad_token", "Google did not say which account signed in.");
  // Both answers describe the same token, so they must name the same account.
  if (info.sub !== undefined && info.sub !== profile.sub) throw new GoogleAuthError("bad_token", REJECTED);
  const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
  if (!email || email.length > 254) throw new GoogleAuthError("no_email", "That Google account has no email address to sign in with.");
  if (profile.email_verified !== true && profile.email_verified !== "true") {
    throw new GoogleAuthError("email_unverified", "That Google account's email address is not verified.");
  }
  return {
    sub: profile.sub.slice(0, 255),
    email,
    name: typeof profile.name === "string" ? profile.name.trim().slice(0, 120) || null : null,
  };
}

async function ask(fetchImpl, url, init) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new GoogleAuthError("unreachable", "Couldn't reach Google to finish signing in. Try again.");
  }
  if (res.status >= 500) throw new GoogleAuthError("unreachable", "Couldn't reach Google to finish signing in. Try again.");
  if (!res.ok) throw new GoogleAuthError("bad_token", REJECTED);
  try {
    return await res.json();
  } catch {
    throw new GoogleAuthError("bad_token", REJECTED);
  }
}

// Turn the access token the extension got from Chrome into a verified identity.
export async function verifyAccessToken(config, accessToken, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const info = checkTokenInfo(
    config,
    await ask(fetchImpl, `${config.google.tokenInfoUrl}?access_token=${encodeURIComponent(accessToken)}`, { method: "GET" }),
    { now },
  );
  const profile = await ask(fetchImpl, config.google.userInfoUrl, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
  return readProfile(profile, info);
}
