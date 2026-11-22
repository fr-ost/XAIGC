# X AI Comment/Reply Generator for Twitter (XAICG)

A free Chrome extension that writes replies, questions, quote lines, posts and threads for X (Twitter), in the user's own voice. Free forever, with no limit, no account and no API key.

**A product of [Unique Labs](https://uniquelabs.org). Developed by Shahriar Ahmed.**

**Setting it up for the first time? Follow [SETUP.md](SETUP.md).** It goes step by step: the counting server, the website and the Chrome Web Store. This README is the reference.

```
 Chrome extension (extension/)                                   XAICG server (server/)
 ┌──────────────────────────────────────────┐   counts only   ┌─────────────────────────┐
 │ buttons on every post, popup, settings    │ ──────────────▶ │ installs and drafts      │
 │ on-device AI model writes every draft     │  (no text)      │ per day, admin dashboard │
 │ cleanup and ranking (lib/engine/)         │                 └───────────┬─────────────┘
 └──────────────────────────────────────────┘                             PostgreSQL
```

## How it works

Every draft is written on the user's own computer by the on-device language model that desktop Chrome provides to extensions (Chrome's Prompt API, the `LanguageModel` interface). Nothing about a post or a draft leaves the computer, and nobody pays per draft, which is why the product can be free with no limit.

**Nothing that users read names the model or calls it Chrome's.** The extension, website, blog, store listing and policies say "on-device AI" or "an AI model that runs on your computer". Keep it that way in anything you add. The policies are still accurate: they say the text is processed on the user's computer and that the model is downloaded once.

- `extension/lib/ondevice.js` checks whether the model is ready, writes drafts with it and passes them through the cleanup and ranking in `extension/lib/engine/` (no dashes, no invented hashtags or links, generic praise ranked last, repeats of recent drafts penalized).
- `extension/lib/device-prompts.js` holds the prompts: short and plain, written for a small model.
- `extension/lib/device-ui.js` is the card in the popup and settings page: ready, needs setup (one-time download with a progress bar), not available on this computer, or update Chrome.
- The model writes English, Spanish, German, French and Japanese. Other languages get a clear message.
- Computers that cannot run it (Chrome's requirements: desktop Chrome on Windows 10/11, macOS 13+, Linux or a Chromebook Plus; about 22 GB free; a GPU with more than 4 GB of memory, or 16 GB of RAM and 4 cores) see "Not available on this computer" with those requirements. There is no fallback: XAICG has no cloud model.

The server exists only to count: it learns that an install exists, its version, and how many drafts of each kind it wrote. The admin dashboard shows users (installs), active users and comments per day.

## Repository layout

| Path | What it is |
| --- | --- |
| `SETUP.md` | The step-by-step setup guide. |
| `extension/` | The Chrome extension (Manifest V3). Load this folder unpacked, or package it for the Chrome Web Store. |
| `server/` | The counting server: install registration, draft counts, admin dashboard. |
| `test/` | The extension's tests, run in Node with a stand-in for the on-device model. |
| `website/` | The product website, as plain files ready to serve. Deploys to Vercel with Root Directory `website`. |
| `content/` | What the website's pages are written from: the home page, about, contact, FAQ, and the blog (`content/blog/`, one Markdown file per article). |
| `store/` | Chrome Web Store material: `assets/` (screenshots, promo tiles, icon), `listing.md` (the text for every dashboard field) and the generator that makes the images from the real extension. |
| `Dockerfile` | Server image. Railway picks it up automatically. |
| `PRIVACY-POLICY.md`, `TERMS.md`, `SUPPORT.md` | The website's privacy, terms and help pages are built from these. |

Helper scripts, run from the top of the repository:

| Command | What it does |
| --- | --- |
| `node scripts/set-api-url.mjs <server address>` | Points the extension's counts at your deployed server. |
| `node scripts/set-version.mjs 4.1.0` | Sets the version of the extension and the server together. |
| `node scripts/pack-extension.mjs` | Makes the zip to upload to the Chrome Web Store. Refuses a build that reports to localhost. |
| `node scripts/build-site.mjs` | Rebuilds every page of the website, the sitemap, `robots.txt` and the blog's feed. Fails if a link between pages leads nowhere. |
| `node scripts/set-site-url.mjs <site address>` | Tells the website its own address and rebuilds it. |
| `node store/generate.mjs` | Rebuilds the store images and the website's screenshots. Needs Playwright. |

## What users get

- **AI Reply** and **Question** buttons on every post on x.com, plus a tone menu with Auto and eight tones and a quote-post line.
- Drafts typed straight into X's reply box (or copied, if they prefer). Nothing is ever posted for them.
- "Try another" steps through more drafts, as often as they like.
- A popup that writes posts in three lengths, threads of three to eight posts, and rewrites.
- A persona, default tone, length, language and emoji settings, and a memory of recent drafts so new ones do not repeat.
- Free, unlimited, no account, no API key.

## The counting server

What it stores, and nothing else:

| Table | What | Why |
| --- | --- | --- |
| `devices` | A hash of the random install ID, a hash of the token, a keyed hash of the registering network, extension version, timestamps, total drafts | Counting users and active users; stopping one network inflating the counts |
| `usage_daily` | Per UTC day: total drafts (`drafts`), drafts per kind (`drafts:reply`...), and each install's own count for the daily cap | Comments per day on the dashboard |

The API:

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/devices` `{installId}` | Register an install, get a token. Called once, on install. |
| `POST /v1/usage` `{kind}` | Count one draft. `kind` is one of `reply`, `question`, `quote`, `post`, `thread`, `rewrite`; anything else in the body is dropped before it is read. |
| `GET /health` | Health check |
| `/admin`, `/admin/api/stats` | Dashboard (Bearer `ADMIN_TOKEN`) |

Abuse controls keep the numbers honest: new installs per network per hour and per day, draft reports per install per minute, and a daily cap per install (reports past it are accepted but not counted). With `ALLOWED_ORIGINS` set, only the published extension may report.

### Deploying it on Railway

1. **Create the project.** In Railway: New Project, Deploy from GitHub repo, pick this repository. Railway finds the root `Dockerfile` and builds the server.
2. **Add the database.** New, Database, PostgreSQL.
3. **Set variables** on the server service:

   | Variable | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `APP_SECRET` | 32+ random characters, for example from `openssl rand -base64 32` |
   | `ADMIN_TOKEN` | 24+ random characters. This is the admin dashboard password. |
   | `ALLOWED_ORIGINS` | `chrome-extension://<your extension id>` once it is published |

4. **Expose it.** Settings, Networking, Generate Domain. Set the health check path to `/health`.
5. **Check it.** `https://<your-domain>/health` returns `{"ok":true,"version":"..."}`, and `https://<your-domain>/admin` shows the dashboard after you enter `ADMIN_TOKEN`.

Every setting is documented in [`server/.env.example`](server/.env.example). Settings from earlier versions (`OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `PLANS_JSON`, `FREE_DAILY_LIMIT` and so on) are ignored, and the server names them in its log at boot so you can delete them.

### Upgrading from 3.x

Version 4 removes the OpenAI engine, plans, licenses, Google sign-in and the free allowance. The database migrates by itself and nothing is dropped: the old tables (`licenses`, `users`, `trial_counters`, `license_events`, `usage_events`) are simply no longer used, so a rollback stays possible. Once you are sure, you can remove them, and the personal data in `users`, with:

```sql
DROP TABLE IF EXISTS license_events, trial_counters, usage_events CASCADE;
ALTER TABLE devices DROP COLUMN IF EXISTS license_id, DROP COLUMN IF EXISTS user_id;
DROP TABLE IF EXISTS licenses, users CASCADE;
```

Revoke the OpenAI API key once 4.0 is live in the store.

### The database

| Host | `DATABASE_URL` | Extra |
| --- | --- | --- |
| Railway Postgres | `${{Postgres.DATABASE_URL}}` | Nothing. |
| Supabase | Project, **Connect**, **Session pooler** string (port `5432`) | `DATABASE_SSL=no-verify`, and `DATABASE_POOL_MAX=5` on small plans. |
| Any other Postgres | Its connection string | `DATABASE_SSL=true` if it requires TLS. |

The server creates and upgrades its tables on boot. Every table has row level security enabled with no policies, so on Supabase the public API key can read nothing.

## Design

The extension, the website, the admin dashboard and the store images share one design system: a near-black canvas (`#0B0E11`), white type and one accent, yellow (`#FCD535`), on every primary action, the wordmark and the headline claims. Cards are flat blocks a step lighter (`#1E2329`). The tokens live at the top of `extension/ui.css`, `extension/content.css`, `website/styles.css` and `server/src/admin-ui/admin.css`. The icon is `store/icon.svg`; `node store/build-icons.mjs` renders every size from it.

## The website

`website/` is plain HTML, CSS and three small scripts. Vercel serves the files as they are; the pages are generated by `node scripts/build-site.mjs` and committed.

| Page | Written in |
| --- | --- |
| Home (`/`) | `content/home.html` |
| Blog (`/blog`) and its articles | `content/blog/*.md`, one file per article |
| FAQ, About, Contact | `content/faq.md`, `content/about.md`, `content/contact.md` |
| Support, Privacy, Terms | `SUPPORT.md`, `PRIVACY-POLICY.md`, `TERMS.md` |

Every page is built with its own title and description, a canonical address, Open Graph tags and schema.org structured data (the free app on the home page, the questions on the FAQ, each article on the blog), plus `sitemap.xml`, `robots.txt` and an RSS feed. The build refuses to finish if a title or description is missing or badly sized, or a link is broken. `website/config.js` holds the site's addresses and the search console verification codes.

A new blog article is a new file in `content/blog/`, named like the others, starting with `title`, `description`, `date` and `tag`.

## Running locally

```bash
cd server
npm install
ADMIN_TOKEN=some-long-local-admin-token npm run dev
```

With no `DATABASE_URL`, the server uses an embedded Postgres (PGlite). To point a development copy of the extension at it, run `node scripts/set-api-url.mjs http://localhost:8787` (and back again before packaging).

## Tests

```bash
node --test "test/*.test.mjs"
```

The extension's tests: the engine, the cleanup and ranking, the background worker's messages and counts, every setup and error state, with a stand-in for the on-device model (Node has none).

```bash
cd server
npm test
```

The server's tests: registration, counting, the abuse limits, the origin check and the admin dashboard. `TEST_DATABASE_URL=postgres://...` runs them against a real Postgres server.

Neither can run the real on-device model. Try the extension on a computer that can: load `extension/` unpacked, press Set up, and press AI Reply on x.com.

## Operations notes

- `APP_SECRET` keys the network hashes. Changing it does no harm beyond resetting the per-network install limits.
- Rate limits are per process; the daily counts live in Postgres and stay exact.
- Client addresses come from `X-Real-IP` on Railway. Elsewhere set `CLIENT_IP_HEADER`. The admin dashboard header shows what the server sees for you.
- If the server is down, the extension works exactly the same; counts from that time are simply lost.

## License

Proprietary. Copyright Unique Labs. All rights reserved.
