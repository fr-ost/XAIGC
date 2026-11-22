# XAICG setup guide

From an empty account to a published, free extension. Follow the parts in order: each one depends on the ones before it.

When you are done you will have:

| Piece | Where it runs | Made in |
| --- | --- | --- |
| The counting server and its admin dashboard (installs and comments) | Railway | Part 2 |
| The database | Railway Postgres | Part 2 |
| The extension | Chrome Web Store | Parts 3 and 5 |
| The product website | Vercel | Part 4 |

The extension writes every draft on the user's own computer, so there is no AI service to pay for and no API key. The server only counts.

Settings pages on these services get renamed from time to time. If a button is not called exactly what this guide says, look for the nearest match.

---

## Before you start

### Accounts

| Account | What for | Cost |
| --- | --- | --- |
| GitHub | Holds this repository. Railway and Vercel deploy from it. | Free |
| [Railway](https://railway.com) | The counting server and its database | Paid, usage based, small for a server that only counts. Check their current pricing. |
| [Chrome Web Store developer](https://chrome.google.com/webstore/devconsole) | Publishing the extension | One-time US$5 registration |
| [Vercel](https://vercel.com) | The website | Free Hobby plan for a non-commercial site. Check their terms. |

### On your computer

- Git
- Node.js 22 or newer (`node --version`)
- Desktop Google Chrome, on a computer that can run the on-device AI (Part 3 lists what it needs)

### Decide two addresses now

| Address | Example | Can you change it later? |
| --- | --- | --- |
| The website | `https://xaicg.yourdomain.com` | Yes, freely |
| The server | `https://api.xaicg.yourdomain.com` | **Not without a new store release.** |

The server's address is built into the extension and listed in its permissions. Changing it after launch means publishing a new version, and Chrome switches an extension off until the user approves a new permission. Railway gives you a free address (`something.up.railway.app`), which is fine for testing; put the server on a domain you own before you submit to the store.

This guide writes `<your-server>` and `<your-site>` for those two addresses.

### Keep these somewhere safe

You will create two secrets: `APP_SECRET` and `ADMIN_TOKEN`. They are only ever typed into Railway's Variables page. Never put them in the repository, the extension or the website.

---

## 1. Get the code and check it

```bash
git clone https://github.com/fr-ost/XAIGC.git
```

```bash
cd XAIGC
```

```bash
node --test "test/*.test.mjs"
```

```bash
cd server && npm install && npm test
```

All tests should pass. They need no accounts and cost nothing.

---

## 2. Put the counting server on Railway

### 2.1 Make two secrets

Run this twice and keep both results:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

One is `APP_SECRET`, the other is `ADMIN_TOKEN` (the admin dashboard's password).

### 2.2 Create the project

1. In Railway: **New Project**, **Deploy from GitHub repo**, choose this repository. Railway finds the `Dockerfile` at the top of the repository and builds the server.
2. In the same project: **New**, **Database**, **PostgreSQL**.

The first deploy will fail, because the variables are not set yet. That is expected.

### 2.3 Set the variables

Open the server service (not the database), then **Variables**:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (type it exactly like this: Railway fills in the real value) |
| `APP_SECRET` | the first secret from 2.1 |
| `ADMIN_TOKEN` | the second secret from 2.1 |

Railway redeploys when you save.

### 2.4 Give it an address

1. Server service, **Settings**, **Networking**, **Generate Domain**. If Railway asks for a port, accept the one it suggests, or add a variable `PORT` = `8787` and enter `8787`.
2. Still in Settings, set the **health check path** to `/health`.
3. To use your own domain (recommended before launch): add a **Custom Domain** in the same section and create the DNS record Railway shows you.

### 2.5 Check it

1. Open `<your-server>/health`. You should see `{"ok":true,"version":"..."}`.
2. Open `<your-server>/admin` and sign in with `ADMIN_TOKEN`. The dashboard shows users (installs), active users and comments per day. Everything is at zero for now.
3. The top of the dashboard says `You: <an address> via x-real-ip`. That should be your own public IP address. If it is a private address such as `10.x.x.x`, see [troubleshooting](#10-troubleshooting).

If the deploy fails, open the **Deploy Logs**: the server names each problem and refuses to start until it is fixed. Railway keeps the previous working version running in the meantime.

---

## 3. Connect the extension and try it

From the top of the repository:

```bash
node scripts/set-api-url.mjs <your-server>
```

This writes the address into `extension/config.js` and into the extension's permissions.

Load it in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked**, and choose the `extension` folder.

The settings page opens. The computer you test on needs desktop Chrome 138 or later on Windows 10/11, macOS 13+, Linux or a Chromebook Plus, about 22 GB of free disk space, and a graphics card with more than 4 GB of memory or 16 GB of RAM. Then check each of these:

- [ ] The settings page says **One step left: set up the AI**. Press **Set up** and wait for the progress bar. It ends with **Ready: free and unlimited**.
- [ ] Click the XAICG icon, type an idea, press **Generate posts**. Three drafts appear.
- [ ] Open `https://x.com/home`. Every post has **AI Reply** and **Question** buttons. (If the tab was already open, reload it.)
- [ ] Press **AI Reply**. X's reply box opens with a draft in it. Nothing is posted.
- [ ] In the admin dashboard, press **Refresh**: one user, and the comments you just made.

---

## 4. Put the website on Vercel

The site is plain files in `website/`, ready to serve: the home page, the blog, FAQ, about, contact, support, privacy and terms. You do not write those files by hand. They are generated from `website/config.js` (addresses), `content/` (the home page, about, contact, FAQ and the blog) and `PRIVACY-POLICY.md`, `TERMS.md` and `SUPPORT.md`. After changing any of them, run:

```bash
node scripts/build-site.mjs
```

then commit and push.

### 4.1 Deploy

1. In Vercel: **Add New**, **Project**, import this repository.
2. Set **Root Directory** to `website`. This is the one setting that matters.
3. **Framework Preset** should read **Other**. Leave the build command and output directory empty.
4. **Deploy**, then add your domain under **Settings**, **Domains**.

### 4.2 Tell the site its address

```bash
node scripts/set-site-url.mjs <your-site>
```

This writes the address into `website/config.js` and rebuilds the pages, so link previews, `robots.txt`, `sitemap.xml` and the blog's feed carry full addresses.

### 4.3 Fill in `website/config.js`

| Setting | What to put |
| --- | --- |
| `siteUrl` | The site's own address. Set by the command in 4.2. |
| `googleSiteVerification`, `bingSiteVerification` | See 4.5. |
| `chromeStoreUrl` | The extension's store address. While it is empty the buttons read "Coming soon". |
| `supportUrl` | Leave as `/support`. |
| `supportEmail` | The address people write to. The contact and support pages' button becomes "Email <address>". While empty, it goes to `contactUrl`. |

Run `node scripts/build-site.mjs`, commit and push. Vercel redeploys on every push.

### 4.4 Write for the blog

Each article is one file in `content/blog/`, named with a number and the words of its address, for example `13-reply-to-big-accounts.md`, which becomes `/blog/reply-to-big-accounts`. It starts with:

```
---
title: How to Reply to Big Accounts on X
description: One or two sentences, 70 to 165 characters. This is the text under the title in a search result.
date: 2026-12-01
tag: Growth
---
```

and then the article in Markdown: `##` for headings, `-` for lists, `>` for an example post or reply, `**bold**`, and `[links](/blog/another-article)`. The build stops and tells you if the description is the wrong length or a link leads nowhere.

Write for a reader: one question per article, answered properly, with examples. Put the words people would search for in the title and the first paragraph, and link to two or three related articles. Do not name the AI model the extension uses; call it on-device AI.

### 4.5 Get found by search engines

Every page already carries its own title and description, a canonical address, structured data, a sitemap and `robots.txt`. What is left is to tell search engines the site exists:

1. In Google Search Console, add a property for the site's address (type **URL prefix**).
2. Choose the **HTML tag** method. Copy only the code from `content="..."` into `website/config.js` as `googleSiteVerification`.
3. Run `node scripts/build-site.mjs`, commit, push, wait for Vercel, then press **Verify**.
4. Under **Sitemaps**, submit `sitemap.xml`.
5. Optional: the same in Bing Webmaster Tools with `bingSiteVerification`.

New sites take days to weeks to appear. What helps: the link from the Chrome Web Store listing, a new article every week or two, and sharing articles where your users are.

---

## 5. Publish on the Chrome Web Store

Before this part, the server should be on the address it will keep. If you moved it since Part 3, run `set-api-url` again.

1. Package the extension:

   ```bash
   node scripts/pack-extension.mjs
   ```

2. In the developer dashboard, upload `dist/xaicg-extension-<version>.zip` (for an existing item: **Package**, **Upload new package**).
3. Fill in every tab from [store/listing.md](store/listing.md), with the images from `store/assets/`.
4. Submit for review.

Once it is approved, put the store address in `website/config.js` as `chromeStoreUrl`, run `node scripts/build-site.mjs`, commit and push.

---

## 6. Lock the counter to your extension

So that only your published extension can register installs and report comments, set on Railway:

| Variable | Value |
| --- | --- |
| `ALLOWED_ORIGINS` | `chrome-extension://<your extension id>` |

The ID is in the store dashboard, and on the extension's card at `chrome://extensions` for an installed copy. To keep testing an unpacked copy (which has a different ID), add its ID too, separated by a comma.

---

## 7. Go live

- [ ] The extension is approved and the website's buttons go to it.
- [ ] `ALLOWED_ORIGINS` is set.
- [ ] `<your-site>/privacy`, `/terms` and `/support` open.
- [ ] The site is submitted to Google Search Console.
- [ ] The admin dashboard shows your own test install.

---

## 8. Day to day

Open `<your-server>/admin`:

| Number | What it means |
| --- | --- |
| Users (installs) | Every install that registered, since the start. Reinstalling creates a new one. |
| Active users | Installs that registered or wrote a draft in the last 7 days (and today, and this month). |
| Comments today / all time | Drafts written, of every kind. |
| Last 30 days | New installs and comments per day, and comments by kind: replies, questions, quotes, posts, threads, rewrites. |
| Versions in use | Which extension versions are active. |

Comments are counted when they are written, whether or not they are posted. If the server is down, the extension keeps working and counts from that time are lost.

---

## 9. Releasing updates

### The extension

1. Set the new version everywhere at once:

   ```bash
   node scripts/set-version.mjs 4.1.0
   ```

2. If the extension's look changed, rebuild the store images and the website's screenshots (needs Playwright):

   ```bash
   node store/generate.mjs
   ```

3. Package it with `node scripts/pack-extension.mjs`, upload it in the dashboard and submit for review. Users are updated automatically after approval.
4. Commit and push.

Avoid adding permissions or changing the server's address in an update: Chrome switches the extension off for existing users until they approve the change.

### The server

Push to the branch Railway deploys. It rebuilds and restarts by itself, and database changes are applied on start.

### The website

Edit the source, run `node scripts/build-site.mjs`, commit and push. Do not edit the `.html` files in `website/` by hand: the next build replaces them.

### Coming from version 3

Version 4 has no OpenAI engine, plans, licenses or sign-in. After 4.0 is live in the store:

- On Railway, delete `OPENAI_API_KEY`, `OPENAI_MODEL`, `GOOGLE_CLIENT_ID`, `BUY_URL`, `SUPPORT_URL`, `PLANS_JSON` and the `FREE_*` and `TRIAL_*` variables. The server lists any it still finds in its log at boot.
- Revoke the OpenAI API key in the OpenAI dashboard.
- The Google Cloud OAuth client for sign-in is no longer used; you can delete it.
- The old database tables are left in place. The README's "Upgrading from 3.x" has the SQL to remove them once you are sure.

---

## 10. Troubleshooting

| What you see | Cause and fix |
| --- | --- |
| The Railway deploy fails or keeps restarting | Open the Deploy Logs. The server names each problem, such as a missing `DATABASE_URL` or `APP_SECRET`. |
| `/health` works but `/admin` is not found | `ADMIN_TOKEN` is not set. The dashboard does not exist without it. |
| The dashboard says `You: 10.x.x.x` | The server is not seeing real visitor addresses. Set `CLIENT_IP_HEADER` to the header your host fills in with the caller's address. On Railway it is `x-real-ip`, the default. |
| Settings say **Not available on this computer** | The computer cannot run the on-device AI: see the requirements in Part 3. |
| Settings say **Update Chrome to use XAICG** | Update Chrome (menu, Help, About Google Chrome) and reload the extension. |
| **Set up** stops partway | Check the free disk space (about 22 GB) and the connection, then press **Set up** or **Check again**. |
| No buttons on x.com | Reload the tab: the extension only joins pages opened after it was installed or updated. If they are missing for everyone, X has changed its page and the extension needs an update. |
| The dashboard shows no users after a test install | `ALLOWED_ORIGINS` does not include this copy's ID, or the extension points at another server (`set-api-url`). Drafts still work either way. |
| The website shows a 404 on Vercel | **Root Directory** is not `website`. |
| The website's buttons say "Coming soon" | `chromeStoreUrl` in `website/config.js` is empty. |
| A change to the website does not show | Run `node scripts/build-site.mjs`, commit and push. |
| `pack-extension` refuses to run | The extension still reports to `localhost`. Run `set-api-url` first. |

Every server setting, with its default, is described in [`server/.env.example`](server/.env.example).

---

## Reference: the helper scripts

Run all of them from the top of the repository.

| Command | What it does |
| --- | --- |
| `node scripts/set-api-url.mjs <your-server>` | Points the extension's counts at your server |
| `node scripts/set-version.mjs 4.1.0` | Sets the version of the extension and the server together |
| `node scripts/pack-extension.mjs` | Makes the zip to upload to the Chrome Web Store |
| `node scripts/build-site.mjs` | Rebuilds every page of the website, the sitemap and the blog's feed |
| `node scripts/set-site-url.mjs <your-site>` | Tells the website its own address and rebuilds it |
| `node store/generate.mjs` | Rebuilds the store images and the website's screenshots |
| `node store/build-icons.mjs` | Renders `store/icon.svg` into every icon file |
