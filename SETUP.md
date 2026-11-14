# XAICG setup guide

From an empty account to a product people can install and pay for. Follow the parts in order: each one depends on the ones before it.

When you are done you will have:

| Piece | Where it runs | Made in |
| --- | --- | --- |
| The server (engine, licensing, trial, admin dashboard) | Railway | Part 2 |
| The database | Railway Postgres | Part 2 |
| Sign in with Google | Google Cloud | Part 5 |
| The extension | Chrome Web Store | Parts 3, 4 and 8 |
| The product website | Vercel | Part 7 |

Settings pages on these services get renamed from time to time. If a button is not called exactly what this guide says, look for the nearest match.

---

## Before you start

### Accounts

| Account | What for | Cost |
| --- | --- | --- |
| GitHub | Holds this repository. Railway and Vercel deploy from it. | Free |
| [OpenAI Platform](https://platform.openai.com) | The API key that writes the drafts | Pay as you go |
| [Railway](https://railway.com) | Server and database | Paid, usage based. Check their current pricing. |
| [Google Cloud](https://console.cloud.google.com) | Sign in with Google | Free |
| [Chrome Web Store developer](https://chrome.google.com/webstore/devconsole) | Publishing the extension | One-time US$5 registration |
| [Vercel](https://vercel.com) | The website | Their free Hobby plan is for personal, non-commercial sites. A site that sells licenses is expected to be on a paid plan: check their terms. |

### On your computer

- Git
- Node.js 22 or newer (`node --version`)
- Google Chrome

### Decide two addresses now

| Address | Example | Can you change it later? |
| --- | --- | --- |
| The website | `https://xaicg.yourdomain.com` | Yes, freely |
| The server | `https://api.xaicg.yourdomain.com` | **Not without a new store release.** |

The server's address is built into the extension and listed in its permissions. Changing it after launch means publishing a new version, and Chrome switches an extension off until the user approves a new permission. So pick the address you will keep. Railway gives you a free one (`something.up.railway.app`) which is fine for testing, but put the server on a domain you own before you submit to the store.

This guide writes `<your-server>` and `<your-site>` for those two addresses.

### Keep these somewhere safe

You will create three secrets. Put them in a password manager as you go: `OPENAI_API_KEY`, `APP_SECRET`, `ADMIN_TOKEN`. They are only ever typed into Railway's Variables page. Never put them in the repository, the extension or the website.

---

## 1. Get the code and check it

```bash
git clone https://github.com/fr-ost/XAIGC.git
```

```bash
cd XAIGC/server
```

```bash
npm install
```

```bash
npm test
```

All tests should pass. They run against an embedded database and a stand-in for OpenAI, so they need no accounts and cost nothing.

---

## 2. Put the server on Railway

### 2.1 Get an OpenAI key

1. In the OpenAI Platform, add a payment method and create an API key. Copy it: it is shown once.
2. In the billing settings, set a monthly budget. The server has its own daily caps, and this is a second line of defense.
3. Look up the name of OpenAI's current small, fast model on their models page. You will need it for `OPENAI_MODEL`.

### 2.2 Make two secrets

Run this twice and keep both results:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

One is `APP_SECRET`, the other is `ADMIN_TOKEN` (the admin dashboard's password).

### 2.3 Create the project

1. In Railway: **New Project**, **Deploy from GitHub repo**, choose this repository. Railway finds the `Dockerfile` at the top of the repository and builds the server. There are no build settings to fill in.
2. In the same project: **New**, **Database**, **PostgreSQL**.

The first deploy will fail, because the variables are not set yet. That is expected.

### 2.4 Set the variables

Open the server service (not the database), then **Variables**:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (type it exactly like this: Railway fills in the real value) |
| `OPENAI_API_KEY` | your OpenAI key |
| `OPENAI_MODEL` | the model name from 2.1 |
| `APP_SECRET` | the first secret from 2.2 |
| `ADMIN_TOKEN` | the second secret from 2.2 |

Railway redeploys when you save.

Never change `APP_SECRET` afterwards. It keys the hashes that free-trial tracking relies on, and a new value gives everyone a fresh trial.

### 2.5 Give it an address

1. Server service, **Settings**, **Networking**, **Generate Domain**. If Railway asks for a port, accept the one it suggests. If it suggests nothing, add a variable `PORT` = `8787` and enter `8787`.
2. Still in Settings, set the **health check path** to `/health`.
3. To use your own domain (recommended before launch, see "Decide two addresses now"): in the same Networking section add a **Custom Domain** and create the DNS record Railway shows you.

### 2.6 Check it

1. Open `<your-server>/health`. You should see `{"ok":true,"version":"3.1.2"}`. The database tables are created on this first start.
2. Open `<your-server>/admin` and sign in with `ADMIN_TOKEN`.
3. Look at the top of the dashboard. It says `You: <an address> via x-real-ip`. That address should be your own public IP address (search "what is my IP" to compare). If it is a private address such as `10.x.x.x`, stop and read the [troubleshooting](#13-troubleshooting) entry about it: otherwise all your users share one rate limit.

If the deploy fails, open the **Deploy Logs**. The server lists exactly what is wrong (a missing variable, a rejected OpenAI key, a model name that does not exist) and refuses to start until it is fixed. Railway keeps the previous working version running in the meantime.

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

Now check each of these. Accounts come later, in Part 5: for now the trial works without signing in.

- [ ] Click the XAICG icon, then **Settings**. It shows a free trial with 20 generations.
- [ ] Click the XAICG icon, type an idea, press **Generate posts**. Three drafts appear.
- [ ] Open `https://x.com/home`. Every post has **AI Reply** and **Question** buttons. (If the tab was already open, reload it.)
- [ ] Press **AI Reply**. X's reply box opens with a draft in it. Nothing is posted.
- [ ] In the admin dashboard, today's generations went up.

---

## 4. Reserve your place in the Chrome Web Store

Google sign-in is tied to the extension's ID, and the ID comes from the store. So the extension is uploaded once now, as a draft that nobody can see, and submitted for review later in Part 8.

1. Register as a developer in the [developer dashboard](https://chrome.google.com/webstore/devconsole) (one-time fee) and verify your email. The account settings also ask whether you are a trader: you are selling licenses, so yes.
2. Package the extension:

   ```bash
   node scripts/pack-extension.mjs
   ```

   It writes `dist/xaicg-extension-3.1.2.zip`. It will mention that Google sign-in is not set up yet, which is expected at this point.
3. In the dashboard: **New item**, upload the zip. Do not submit it.
4. Note two things from the dashboard:
   - the **item ID**: 32 letters, shown on the item and in its address
   - the **public key**: **Package** tab, **View public key**. Copy the long line between the BEGIN and END lines.

---

## 5. Turn on Google sign-in

People sign in inside the extension: Chrome shows its own Google account prompt, and no web page opens. With sign-in on, the free trial is one per Google account, licenses follow people between computers, and the dashboard shows you who your users are.

In the [Google Cloud console](https://console.cloud.google.com):

1. Create a project (the project picker at the top, **New project**). Call it XAICG.
2. Open **Google Auth Platform** (older screens call it **APIs & Services**, **OAuth consent screen**).
3. **Branding**: app name `XAICG`, your support email, and, once the website is up, its address and `<your-site>/privacy` as the privacy policy.
4. **Audience**: choose **External**, then press **Publish app**. Until you do, the app is in testing mode and only the test users you list can sign in.
5. **Data access**: the only scopes needed are `openid`, `email` and `profile`. These need no review from Google.
6. **Clients**, **Create client**. Choose the type **Chrome Extension** (not Web application) and paste the **item ID** from Part 4. Copy the **client ID** it gives you. There is no client secret, and none is needed.

Give the client ID to the extension, together with the public key from Part 4:

```bash
node scripts/set-google-client.mjs <client-id> --key "<public key>"
```

The key makes your unpacked copy use the same ID as the store item, so sign-in works while you test. It is left out of the zip you upload.

Then in Railway, add to the server's variables:

| Variable | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | the same client ID |

If you used an earlier version of this project, delete `GOOGLE_CLIENT_SECRET` and `PUBLIC_URL` from Railway. They are no longer used.

Now try it. At `chrome://extensions`, press the reload arrow on the extension (its ID changes to the store's ID, once), then:

- [ ] Click the XAICG icon, then **Settings**. Press **Sign in with Google**. Chrome asks which account to use, and the page shows your name. No tab opens.
- [ ] The settings page shows a free trial with 20 generations.
- [ ] In the admin dashboard, your account appears under **Users**.

Three things to know:

- Chrome must be signed in to a Google account (the profile button at the top right). If it is not, Chrome asks the person to sign in first.
- This kind of sign-in works in Google Chrome. Other Chromium browsers do not offer it.
- Until Google has verified your branding (optional and free, started from the Branding page), the prompt may show less of your app's name and logo.

To keep signing in optional rather than required for the trial, set `TRIAL_REQUIRE_SIGN_IN=false`.

---

## 6. Issue your first license

In the admin dashboard:

1. **Issue licenses**: plan **Pro**, your own email address, one key.
2. The key is shown once. Copy it.
3. In the extension's settings, press **Refresh**. Because the license was issued to the email you signed in with, the page says your account has a Pro license. Press **Use it on this browser** and the plan reads Pro, with no key typed. (A customer never needs that button: the license arrives by itself when they sign in, or with their next draft if they were signed in already.)
4. To see what a customer without an account sees: sign out, paste the key under **License key**, press **Activate**.

That is the whole selling loop: take payment, issue a license to the customer's email, and it is theirs the next time they sign in or write a draft.

---

## 7. Put the website on Vercel

The site is plain files in `website/`. There is nothing to build.

### 6.1 Deploy

1. In Vercel: **Add New**, **Project**, import this repository.
2. Set **Root Directory** to `website`. This is the one setting that matters.
3. **Framework Preset** should read **Other**. Leave the build command and output directory empty.
4. **Deploy**.
5. To use your own domain: project **Settings**, **Domains**.

### 6.2 Tell the site its address

```bash
node scripts/set-site-url.mjs <your-site>
```

This lets link previews on X, Slack and WhatsApp show the site's image, and writes `robots.txt` and `sitemap.xml`.

### 6.3 Fill in `website/config.js`

It is the only file you need to edit.

| Setting | What to put |
| --- | --- |
| `chromeStoreUrl` | Leave empty for now. The buttons read "Coming soon". You fill it in after Part 8. |
| `buyUrl` | Where people pay. A payment link, or a page where they can reach you. |
| `supportUrl` | Where people get help |
| `trialGenerations` | Must equal the server's `TRIAL_GENERATIONS` (20 unless you changed it) |
| `plans` | Names, limits and prices. They are set to Starter $0.99, Pro $1.99 and Agency $4.99 per month. Write prices as you want them shown, for example `price: "$0.99"`, `period: "per month"`. The limits must equal the server's plans. |

Commit and push. Vercel redeploys on every push.

### 6.4 Point the extension's buttons at the site

In Railway, add to the server's variables:

| Variable | Value |
| --- | --- |
| `BUY_URL` | `<your-site>/#pricing` |
| `SUPPORT_URL` | your support page |

These are where **Get a license** and **Support** inside the extension lead.

---

## 8. Publish on the Chrome Web Store

Before this part, the server should be on the address it will keep (see "Decide two addresses now"). If you moved it since Part 3, run `set-api-url` again with the final address.

1. Package the extension again, now that it has its Google client:

   ```bash
   node scripts/pack-extension.mjs
   ```

   It refuses if the extension still points at `localhost`, and it should no longer mention Google sign-in.
2. In the dashboard, open the item from Part 4, **Package**, **Upload new package**.
3. Fill in the listing from [`store/listing.md`](store/listing.md). It has the text for every field, the answers for the privacy questions, and which image goes where. The images are in `store/assets/`.
4. For the reviewers, issue a Pro license in the admin dashboard with the note "Chrome Web Store review" and paste its key into the test instructions, as `store/listing.md` shows.
5. **Submit for review.** Reviews usually take a few days and can take longer for a new developer account.

---

## 9. Lock the API to your extension

In Railway, add:

| Variable | Value |
| --- | --- |
| `ALLOWED_ORIGINS` | `chrome-extension://<the item ID from Part 4>` |

From then on the server takes requests only from your extension. You do not need to wait for the review.

Your unpacked copy has the same ID (because of the public key from Part 5), so it keeps working. A copy loaded without that key has a different ID, shown on its card at `chrome://extensions`, and is refused. To allow one anyway, list both IDs, separated by a comma. Such a copy also needs its own Chrome Extension client in Google, added to `GOOGLE_CLIENT_ID` the same way.

---

## 10. Go live

When the review is approved:

- [ ] Put the store address in `website/config.js` as `chromeStoreUrl`, commit and push. The site's buttons change to **Add to Chrome**.
- [ ] Install the extension from the store, in a Chrome profile that has never had it, and run the checklists from Parts 3 and 5 once more.
- [ ] Revoke the reviewers' license in the admin dashboard.
- [ ] Read [Part 14](#14-before-you-take-money).

---

## 11. Day to day

Everything is done from `<your-server>/admin`.

| Task | How |
| --- | --- |
| Sell a license | **Issue licenses**: plan, validity and the customer's email. It is theirs when they sign in with that Google account, or with their next draft if they are signed in already. Send them the key as well, as a fallback. |
| Customer lost their key | Open the license, **Rotate key**. The old key stops working and a new one is shown once. |
| Customer got a new computer | Nothing to do. They sign in and the license is there. If every seat is taken, the extension lets them choose which browser gives its seat up. |
| Refund or chargeback | Open the license, **Revoke**. |
| Someone is abusing the trial or a license | **Users**, open the user, **Block**. They are shut out on every browser, and the licenses they own stop working. |
| A data deletion request | **Users**, open the user, **Delete**. Their name, email and Google ID are erased. |
| Watch the cost | The dashboard shows today's generations and an estimate of the OpenAI cost. `GLOBAL_DAILY_CAP` and `TRIAL_GLOBAL_DAILY_CAP` are the hard ceilings. |

To issue licenses automatically after a payment, have your payment provider's webhook call the admin API:

```bash
curl -X POST <your-server>/admin/api/licenses \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan":"pro","email":"customer@example.com","days":365,"note":"order 1042"}'
```

The answer contains the new key under `licenses[0].key`. Make that call from a server of yours, never from a web page, because it carries `ADMIN_TOKEN`.

Back up the database. Every license and account lives in it. Use Railway's backups for the Postgres service if your plan includes them, or take a `pg_dump` on a schedule.

---

## 12. Releasing updates

### The extension

1. Set the new version everywhere at once:

   ```bash
   node scripts/set-version.mjs 3.2.0
   ```

2. If the extension's look changed, rebuild the store images and the website's screenshots (needs Playwright: `npm i -D playwright` and `npx playwright install chromium`):

   ```bash
   node store/generate.mjs
   ```

3. Package it:

   ```bash
   node scripts/pack-extension.mjs
   ```

4. In the developer dashboard, open the item, **Package**, **Upload new package**, then submit for review. Users are updated automatically after approval.
5. Commit and push, so the server reports the same version.

If an old version must stop working, for instance after X changes its pages and breaks it, set `MIN_CLIENT_VERSION` on the server. Older installs are told to update.

Avoid adding permissions or changing the server's address in an update: Chrome switches the extension off for existing users until they approve the change.

### The server

Push to the branch Railway deploys. It rebuilds and restarts by itself, and database changes are applied on start. If the new version fails its health check, Railway keeps the old one running.

### The website

Edit, commit, push. Vercel redeploys.

### The privacy policy and the terms

The policy is written once, in `PRIVACY-POLICY.md`, and the terms in `TERMS.md`. After changing either:

```bash
node scripts/build-privacy.mjs
```

That rebuilds `website/privacy.html` and `website/terms.html`. Commit and push. If what the extension collects has changed, update the privacy answers in the store dashboard too.

---

## 13. Troubleshooting

| What you see | Cause and fix |
| --- | --- |
| The Railway deploy fails or keeps restarting | Open the Deploy Logs. The server names each problem: a missing variable, an OpenAI key that was rejected, or an `OPENAI_MODEL` that does not exist for your key. |
| `/health` works but `/admin` is not found | `ADMIN_TOKEN` is not set. The dashboard does not exist without it. |
| The dashboard says `You: 10.x.x.x` (or another private address) | The server is not seeing real visitor addresses, so everyone shares one rate limit. Set `CLIENT_IP_HEADER` to the header your host fills in with the caller's address. On Railway this is `x-real-ip` and is the default. |
| Sign-in says it is not set up in this build | The extension has no Google client yet. Run `node scripts/set-google-client.mjs <client-id>` and reload the extension. |
| Sign-in fails with a message about the client ID or OAuth | The Google client was created for a different extension ID. In Google Auth Platform, **Clients**, the Chrome Extension client's item ID must be the ID shown on the extension's card at `chrome://extensions`. An unpacked copy only has the store's ID if you passed `--key` in Part 5. |
| "That Google sign-in was issued for a different app" | `GOOGLE_CLIENT_ID` on the server is not the client ID in the extension. They must be the same value. |
| Sign-in asks to sign in to Chrome first | Chrome itself is not signed in to a Google account. Use the profile button at the top right of Chrome. |
| Google says access is blocked, or the app is being tested | The app is still in testing mode. In Google Auth Platform, **Audience**, press **Publish app**, or add the person as a test user. |
| The settings page has no **Sign in with Google** button | The server has no `GOOGLE_CLIENT_ID`, or was not redeployed after it was added. Press **Refresh** in settings afterwards. |
| The extension cannot reach the server | It points at the wrong address. Run `node scripts/set-api-url.mjs <your-server>` again, then press the reload arrow on the extension's card at `chrome://extensions`. |
| "This client is not allowed to use the API" | `ALLOWED_ORIGINS` is set and does not include this copy of the extension. See Part 9. |
| No buttons on x.com | Reload the tab: the extension only joins pages opened after it was installed or updated. If they are still missing for everyone, X has changed its page and the extension needs an update. |
| A tester's trial ran out at once | Trial use is also counted per network (three trials' worth per 30 days by default). Several testers on one office network share that. Raise `TRIAL_IP_LIMIT`, or give testers licenses. |
| The website shows a 404 on Vercel | **Root Directory** is not `website`. Change it in the project's settings and redeploy. |
| The website's buttons say "Coming soon" | `chromeStoreUrl` in `website/config.js` is empty. |
| Links to the site show no preview image | Run `node scripts/set-site-url.mjs <your-site>` and push. |
| `pack-extension` refuses to run | The extension still points at `localhost`. Run `set-api-url` first. |

Every server setting, with its default, is described in [`server/.env.example`](server/.env.example).

---

## 14. Before you take money

The code is ready to sell. These parts are yours to add, and none of them are in this repository:

- **A way to pay.** A payment link or a checkout from a provider such as Stripe, Paddle or Lemon Squeezy. Put its address in `website/config.js` as `buyUrl`. Issue licenses by hand at first, or automatically with the admin API call in Part 11.
- **Terms and a refund policy that are really yours.** The site has a terms page, built from `TERMS.md`. It is a sensible starting text, not legal advice: read it, set the refund rule you actually want in section 6, add the country whose law applies, and have it checked before you rely on it. After editing, run `node scripts/build-privacy.mjs`.
- **A support address** that someone reads.
- **Your business details** for the store's trader declaration and for invoices.

---

## Reference: the helper scripts

Run all of them from the top of the repository.

| Command | What it does |
| --- | --- |
| `node scripts/set-api-url.mjs <your-server>` | Points the extension at your server |
| `node scripts/set-google-client.mjs <client-id>` | Gives the extension its Google sign-in client |
| `node scripts/set-version.mjs 3.2.0` | Sets the version of the extension and the server together |
| `node scripts/pack-extension.mjs` | Makes the zip to upload to the Chrome Web Store |
| `node scripts/set-site-url.mjs <your-site>` | Tells the website its own address |
| `node scripts/build-privacy.mjs` | Rebuilds the website's privacy and terms pages from `PRIVACY-POLICY.md` and `TERMS.md` |
| `node store/generate.mjs` | Rebuilds the store images and the website's screenshots |
| `node store/build-icons.mjs` | Renders `store/icon.svg` into every icon file |
