# XAIGC: AI Content Generator for X

Replies, questions, quote lines, posts and threads for X (Twitter), written in the user's own voice.

**A product of [Unique Labs](https://uniquelabs.org). Developed by Shahriar Ahmed.**

Version 3 is a full reboot. The old extension called OpenAI from the browser with each user's own API key. Now the extension is a thin client and everything that matters runs on a server you control: the writing engine, the OpenAI key, licensing, the free trial and abuse prevention.

```
 Chrome extension (extension/)                 XAIGC server (server/)                OpenAI
 ┌───────────────────────────┐   HTTPS    ┌──────────────────────────────┐        ┌────────┐
 │ buttons on every post      │ ────────▶ │ rate limits, origin check     │ ─────▶ │ model  │
 │ popup compose studio       │           │ device token, license, quota  │ ◀───── │        │
 │ settings + license page    │ ◀──────── │ prompts, ranking, moderation  │        └────────┘
 └───────────────────────────┘   drafts   │ admin dashboard (/admin)      │
                                          └───────────────┬──────────────┘
                                                          │
                                                     PostgreSQL
```

## Repository layout

| Path | What it is |
| --- | --- |
| `extension/` | The Chrome extension (Manifest V3). Load this folder unpacked, or zip it for the Chrome Web Store. |
| `server/` | Node.js API: engine, licensing, trial, quotas, admin. |
| `server/test/` | The test suite. Runs on an embedded Postgres or a real one. |
| `Dockerfile` | Server image. Railway picks it up automatically. |
| `scripts/set-api-url.mjs` | Points the extension at your deployed server. |
| `PRIVACY-POLICY.md` | Privacy policy matching what the code does. |

## What users get

- **AI Reply** and **Question** buttons on every post, plus a tone menu (casual, witty, supportive, skeptical, analytical, blunt, technical, professional).
- Drafts are typed into X's reply box for review. Nothing is ever posted automatically. A clipboard-only mode is available.
- **Try another** steps through alternative drafts the server already returned, without spending another generation.
- **Compose studio** in the toolbar popup: original posts, threads and rewrites of a draft.
- A persona description, default tone, reply length, language and emoji preference that apply to everything.
- **Sign in with Google.** One free trial per Google account, and a license that follows the account it was issued to: on a new browser the user signs in and is licensed, with no key to type.
- A license key still works on its own, for customers who prefer not to sign in.

## Deploying the server on Railway

Railway was chosen over Vercel because this backend wants a long-running process with a database beside it: rate limits live in memory, there are no cold starts, and Postgres is one click. Any host that runs a Docker image and offers Postgres works the same way.

1. **Create the project.** In Railway: New Project, Deploy from GitHub repo, pick this repository. Railway finds the root `Dockerfile` and builds the server. No build settings are needed.
2. **Add the database.** In the project: New, Database, PostgreSQL.
3. **Set variables** on the server service (Variables tab):

   | Variable | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `OPENAI_API_KEY` | your OpenAI key |
   | `OPENAI_MODEL` | OpenAI's current small, fast model (see the note below) |
   | `APP_SECRET` | 32+ random characters, for example from `openssl rand -base64 32` |
   | `ADMIN_TOKEN` | 24+ random characters. This is the admin dashboard password. |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From Google, to switch on sign-in (see below). Optional. |

4. **Expose it.** Settings, Networking, Generate Domain. Set the health check path to `/health`.
5. **Check it.** Open `https://<your-domain>/health`. It should return `{"ok":true,"version":"3.0.0"}`. The schema is created on first boot.
6. **Check that the server sees real client addresses.** Sign in at `https://<your-domain>/admin`. The header shows `You: <address> via x-real-ip`. That address should be your own public IP. If it is a private address (`10.x`, `100.64.x`, `192.168.x`), every user is sharing one rate-limit bucket: set `CLIENT_IP_HEADER` to the header your host fills in with the caller's address.

The server refuses to start in production if a required variable is missing, if `OPENAI_API_KEY` is rejected, or if `OPENAI_MODEL` does not exist for your key. Railway then keeps the previous healthy deployment running, and the deploy log says exactly what to fix.

> **About `OPENAI_MODEL`.** OpenAI retires its small models regularly, so the model is configuration, not code. The built-in default is `gpt-6-luna`. Confirm the current small model on OpenAI's models page and set `OPENAI_MODEL` explicitly. Request parameters that differ between model families (`temperature`, `reasoning_effort` and so on) are adjusted automatically, so switching models needs no code change.

Every setting is documented in [`server/.env.example`](server/.env.example).

## The database

The server needs one Postgres database and nothing else. It creates and upgrades its own tables on boot, so there is no schema to install by hand, and every user, license and usage counter the admin dashboard shows lives there.

| Host | `DATABASE_URL` | Extra |
| --- | --- | --- |
| Railway Postgres | `${{Postgres.DATABASE_URL}}` | Nothing. |
| Supabase | Project, **Connect**, **Session pooler** string (port `5432`, host `aws-...pooler.supabase.com`) | `DATABASE_SSL=no-verify`, and `DATABASE_POOL_MAX=5` on small plans. |
| Any other Postgres | Its connection string | `DATABASE_SSL=true` if it requires TLS. |

Railway Postgres is the simplest choice: it lives in the same project as the server, on its private network, with nothing to configure. The server waits up to about 40 seconds for the database when it boots, so on a first deploy it does not matter which of the two starts first.

On Supabase, use the session pooler rather than the direct connection (which is IPv6-only without an add-on) or the transaction pooler (port `6543`, meant for serverless functions). A free Supabase account is limited to two active projects.

Every table has row level security enabled with no policies. The server connects as the table owner and is unaffected. This matters on Supabase, where tables in the `public` schema are otherwise readable through the project's auto-generated API with its public (anon) key: with RLS on, that key gets nothing. Row level security does not restrain privileged credentials (the database password, or Supabase's `service_role` key), so keep those secret as you would for any database. You can look at the data in Supabase's table editor, but make changes through the admin dashboard: keys, tokens and addresses are stored as hashes and cannot be edited by hand.

If you set `DATABASE_SSL` or `DATABASE_SSL_CA`, they take precedence over any `sslmode=` in the connection string.

## Google sign-in

Sign-in is off until you give the server Google credentials. With it on, people must sign in before the free trial starts, which limits the trial to one per Google account and gives you a list of who your users are.

1. In Google Cloud Console, create an OAuth client of type **Web application** (you will be asked to fill in the consent screen first: app name, support email, and the default `openid`, `email` and `profile` scopes).
2. Add one **Authorized redirect URI**: `https://<your-domain>/auth/google/callback`
3. Set on the server:

   | Variable | Value |
   | --- | --- |
   | `GOOGLE_CLIENT_ID` | the client ID |
   | `GOOGLE_CLIENT_SECRET` | the client secret |
   | `PUBLIC_URL` | `https://<your-domain>`. It must be the same address the extension uses (the one you gave `set-api-url`). On Railway it defaults to the generated domain; set it when you use a custom domain. |

4. Redeploy. The extension's settings page now shows **Sign in with Google**.

Set `TRIAL_REQUIRE_SIGN_IN=false` if you would rather keep signing in optional.

How it works: the extension opens Google in a normal tab and Google returns to the server with the account's basic profile (the `openid`, `email` and `profile` scopes). The server keeps the account ID, name and verified email, discards the rest, and stores no Google token. The sign-in only takes effect when the same browser that started it presents a one-time code together with its own device token, so a sign-in link sent to someone else does nothing.

Who owns a license: the Google account whose verified email the license was issued to, and nobody else. Typing a key gives that browser a seat; it never makes the signed-in account the owner. So someone who was given one seat, or who got hold of a key, cannot move the license around or keep it after you rotate the key.

## Connecting the extension

1. Point the extension at your server:

   ```bash
   node scripts/set-api-url.mjs https://your-app.up.railway.app
   ```

2. Load it: open `chrome://extensions`, turn on Developer mode, Load unpacked, choose the `extension/` folder.
3. To publish, zip the contents of `extension/` and upload the zip to the Chrome Web Store.
4. After publishing, lock the API to your extension. Copy the extension ID from `chrome://extensions` and set this on the server:

   ```
   ALLOWED_ORIGINS=chrome-extension://<your-extension-id>
   ```

## Selling and managing licenses

Open `https://<your-domain>/admin` and sign in with `ADMIN_TOKEN`.

- **Issue licenses**: choose a plan, validity (never expires, N days from first activation, or a fixed end date), optional customer email and note, and how many keys. Keys look like `XAIGC-7K2QM-9D4TX-B81RC-0HVNE`.
- **Keys are shown once.** Only a hash is stored, so a leaked database cannot be turned into working keys. If a customer loses a key, use Rotate key.
- **Manage**: revoke or restore, extend, change limits, release devices, block an install, and see per-license usage and history.
- **Dashboard**: generations today, estimated OpenAI cost, active licenses, installs, users.
- **Users**: everyone who has signed in, with their plan, trial use, browsers and generations. Search, filter, and issue a license to a user.
  - **Block** shuts the user out on all of their browsers at once and disables the licenses they own everywhere, including by key.
  - **Delete** is for data deletion requests. It erases the account's Google ID, name and email, including the email on their licenses (which become key-only), and signs their browsers out. It keeps their free-trial count under a keyed hash, so the trial cannot be restarted, and usage records that carry no name or email. Deleting a blocked user removes the block, so block abusers rather than deleting them.
- **Licenses by email**: put the customer's email on a license and it becomes theirs the moment they sign in with that Google account. If they already have an account, it is active on their next click, provided a seat is free and they have not removed it from that browser. The key is only a fallback. Changing the email on a license moves it to the new person.

Built-in plans (change them with `PLANS_JSON`, or override limits per license):

| Plan | Generations per day | Devices |
| --- | --- | --- |
| `starter` | 60 | 1 |
| `pro` | 200 | 2 |
| `agency` | 600 | 5 |

Licenses are issued by you. Hooking a payment provider up to `POST /admin/api/licenses` so keys are issued automatically after checkout is the natural next step.

## How abuse is prevented

| Risk | Control |
| --- | --- |
| The API used as a free OpenAI proxy | The server owns the prompts. Clients send only a post, idea or draft plus a few style options. Inputs are length-capped, the model and output size are fixed server side, and output is limited to post-length text. |
| Free trial reset by reinstalling | With Google sign-in on, one trial per Google account. In addition, trial use is counted against the install, the X account (hashed) and the network (hashed) at the same time, and an install stays tied to the X account it reported. |
| Trial farming with many installs | A per-network trial allowance over a 30-day window, a cap on new installs per network, and a global daily cap on trial generations. |
| License sharing | Device limit per license, a daily quota shared by all of a license's devices, a limit on activations per 30 days, a daily cap on re-issuing an install's token (so an install id cannot be passed around as a seat), and a dashboard warning when one key is used from many networks. |
| Key guessing | 100-bit keys. Wrong keys are throttled per network and per install. A correct key is always accepted, so the throttle cannot be turned against a paying customer. |
| Flooding and scripts | Rate limits per network and per install, one generation at a time per install, a short cooldown, small request bodies, and an optional origin allowlist. The in-page buttons ignore clicks made by scripts. |
| A runaway OpenAI bill | Hard global caps on generations per day, and a time budget per generation. Failures are refunded, but a failure the model was already paid for is refunded only a few times an hour per install and network, so no input can be looped to spend money for free. |
| Harmful output | Safety rules in the system prompt, OpenAI moderation on every result, and a pseudonymous per-user id sent to OpenAI so misuse is attributed to one user. |
| Stolen credentials | Device tokens, install IDs and license keys are stored only as hashes. IPs and X accounts are stored only as keyed hashes. Reinstalling rotates the device token. |
| Taking over someone's license | A license is owned only by the Google account whose verified email it was issued to. A key gives a seat, never ownership, and an account whose address has since moved to another Google account can no longer claim it. Moving a license to another browser happens only when its owner asks. |
| Account takeover through sign-in | The sign-in completes only when the browser that started it presents a one-time code plus its own device token. States and codes are single use and expire in ten minutes. Google's response is checked for issuer, audience, nonce, expiry and a verified email. |
| Abusive users | Block a user from the dashboard: every browser they are signed in on is refused immediately, and the licenses they own stop working everywhere, including on browsers that only have the key. |
| Admin takeover | Constant-time token comparison, throttling of wrong tokens (the correct token is never locked out), and the admin surface does not exist unless `ADMIN_TOKEN` is set. |

Quota counters are reserved in Postgres before the model is called, inside one transaction, so parallel requests cannot overspend a limit.

Three honest limits. Without Google sign-in, a person with a new network, a new X account and a fresh browser profile gets a new trial (with it, they also need a new Google account). An origin allowlist stops other websites and casual scripts, not a determined person imitating the extension. And a device token copied out of one browser into another works in both, like any bearer credential. That is why every limit that costs money is enforced on the server, and why a license's daily quota is shared by all of its devices: copying a seat adds no capacity.

## Running locally

```bash
cd server
npm install
OPENAI_API_KEY=sk-... ADMIN_TOKEN=some-long-local-admin-token npm run dev
```

With no `DATABASE_URL`, the server uses an embedded Postgres (PGlite), so there is nothing to install. It listens on `http://localhost:8787`, which is where the extension points by default.

## Tests

```bash
cd server
npm test
```

The suite covers the trial, licensing, quotas, every abuse control, the engine's cleanup and ranking, and the admin API, with OpenAI replaced by an in-process fake. To run it against a real Postgres server:

```bash
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
```

## API

All responses are JSON. Errors have the shape `{"error":{"code":"...","message":"..."}}`.

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/devices` | Register an install, get a device token |
| `GET /v1/me` | Plan, license state and remaining allowance |
| `POST /v1/generate` | Write drafts: `reply`, `question`, `quote`, `post`, `rewrite`, `thread` |
| `POST /v1/license/activate` | Bind a license key to this install |
| `POST /v1/license/deactivate` | Release it |
| `POST /v1/license/attach` | Bring the signed-in account's license to this install |
| `POST /v1/auth/google/start` | Begin a sign-in, get the Google URL to open |
| `GET /auth/google/callback` | Where Google sends the browser back |
| `POST /v1/auth/google/complete` | Finish the sign-in with the one-time code |
| `POST /v1/auth/signout` | Sign this install out |
| `GET /health` | Health check |
| `/admin`, `/admin/api/*` | Dashboard and admin API (Bearer `ADMIN_TOKEN`) |

## Operations notes

- `APP_SECRET` keys the IP and X-account hashes. Changing it resets trial tracking but does not affect licenses.
- Rate limits are per process. If you run several replicas, each enforces its own. Trial, daily and global limits live in Postgres and stay exact.
- Per-request usage records are pruned after 60 days (`USAGE_EVENT_RETENTION_DAYS`). They never contain post text or generated text.
- Client addresses come from `X-Real-IP` on Railway. On any other host nothing is assumed and the socket address is used, so set `CLIENT_IP_HEADER` to a header your platform overwrites with the caller's address (never one a client can set freely). The admin dashboard header shows what the server sees for you.
- Reinstalling the extension creates a new install. A customer whose license was issued to their email just signs in again and it comes back. A customer using only a key enters it again; if the old install still holds a seat, the settings page offers to move the license to the current browser.
- The Google client secret stays on the server. If it leaks, rotate it in Google Cloud Console and update `GOOGLE_CLIENT_SECRET`; signed-in users are not affected.

## License

Proprietary. Copyright Unique Labs. All rights reserved.
