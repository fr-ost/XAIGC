# Chrome Web Store listing

Everything the developer dashboard asks for, in the order it asks. Text in code blocks is meant to be pasted as it is.

| | |
| --- | --- |
| Store item ID | `lpophlkocboadjhancbdikipnphffgil` |
| Listing address | `https://chromewebstore.google.com/detail/lpophlkocboadjhancbdikipnphffgil` |
| Server | `https://aigc.uniquelabs.org` |
| Website | `https://xaicg.uniquelabs.org` |

The images are in [`store/assets/`](assets/). Rebuild them with `node store/generate.mjs` after the extension's look changes.

---

## 1. Package

Upload `dist/xaicg-extension-<version>.zip`, made with:

```bash
node scripts/pack-extension.mjs
```

The name and the short summary on the store come from `extension/manifest.json`, not from the dashboard:

| Field | Value | Limit |
| --- | --- | --- |
| Name | `X AI Comment/Reply Generator for Twitter` | 40 of 75 characters |
| Summary | `AI comments and replies for X (Twitter) in your own voice, plus questions, posts and threads. A product of Unique Labs.` | 119 of 132 characters |

---

## 2. Store listing tab

### Description

```
X AI Comment/Reply Generator for Twitter (XAICG) drafts comments, replies, posts and threads for X (Twitter) in your own voice. You read every draft and post it yourself.

HOW IT WORKS
XAICG adds two buttons to every post on x.com: AI Reply and Question. Click one and a draft is typed into X's own reply box. Change it if you like, then press Reply. Nothing is ever posted for you.

WHAT YOU CAN DO
• Reply to any post with one click
• Ask a short, specific question about a post
• Pick a tone when you want one: casual, witty, supportive, skeptical, analytical, blunt, technical or professional. Auto picks one to fit the post.
• Not happy with a draft? "Try another" steps through more drafts without using another generation
• Copy a line for a quote post
• Write original posts in three lengths from a rough idea
• Turn one idea into a thread of three to eight posts
• Rewrite a draft of your own so it reads better and keeps your facts, names and links
• Write in English, in the post's own language, or in one of 17 languages you choose
• Soft sound effects when a draft arrives and when you send your reply. Switch them off in Settings if you prefer quiet.

SOUNDS LIKE YOU
Describe your persona once, or start from a preset and edit it. XAICG is built to avoid the usual signs of AI writing: no generic praise, no hype words, no hashtags you did not ask for. It reacts to one concrete detail in the post, the way a person does, and it keeps track of your recent drafts so it does not repeat itself.

NO API KEY
You do not need an OpenAI account or an API key. Install it, sign in with Google and start writing.

FREE TRIAL AND PLANS
• Free trial: 20 generations, with every tone and every writing mode. No card needed.
• Starter, $0.99 a month: 60 generations a day, one browser
• Pro, $1.99 a month: 200 generations a day, two browsers
• Agency, $4.99 a month: 600 generations a day, five browsers
A license belongs to your Google account, so on a new computer you sign in and it is there. Licenses are sold at https://xaicg.uniquelabs.org.

PRIVACY
• XAICG reads only the post you click, and nothing else on the page
• It never reads your direct messages, followers or password
• The post's text is sent to the XAICG server and on to OpenAI to write the draft. The server does not save that text or the draft.
• No advertising, no analytics trackers, no sale of data
Full policy: https://xaicg.uniquelabs.org/privacy
Terms: https://xaicg.uniquelabs.org/terms

ABOUT
XAICG is a product of Unique Labs (uniquelabs.org), developed by Shahriar Ahmed.

XAICG is an independent product. It is not affiliated with, endorsed by or sponsored by X Corp. X and Twitter are trademarks of their owner.
```

If you change `TRIAL_GENERATIONS` or the plans on the server, change the numbers here and in `website/config.js` as well. If you run without Google sign-in, change "sign in with Google and start writing" to "and start writing", and drop the sentence about the license belonging to a Google account.

### Category and language

| Field | Value |
| --- | --- |
| Category | **Social Networking**. If you would rather be listed with writing tools, **Communication** also fits. |
| Language | English |

### Graphic assets

| Dashboard field | File | Size |
| --- | --- | --- |
| Store icon | `store/assets/icon-128.png` | 128×128 |
| Screenshot 1 | `store/assets/screenshot-1.png` (reply in one click) | 1280×800 |
| Screenshot 2 | `store/assets/screenshot-2.png` (tone menu) | 1280×800 |
| Screenshot 3 | `store/assets/screenshot-3.png` (posts and threads) | 1280×800 |
| Screenshot 4 | `store/assets/screenshot-4.png` (voice settings) | 1280×800 |
| Screenshot 5 | `store/assets/screenshot-5.png` (trial and license) | 1280×800 |
| Small promo tile | `store/assets/promo-small.png` | 440×280 |
| Marquee promo tile | `store/assets/promo-marquee.png` | 1400×560 |

Upload the screenshots in this order: the first one is what people see in search results.

The screenshots show the real extension on a sample timeline with made-up accounts. They do not show X's logo or anyone's real posts.

### Additional fields

| Field | Value |
| --- | --- |
| Homepage URL | `https://xaicg.uniquelabs.org` |
| Support URL | `https://xaicg.uniquelabs.org` or your support page |
| Official URL | Optional. Needs the site verified in Google Search Console. |
| Mature content | No |

---

## 3. Privacy practices tab

### Single purpose

```
XAICG writes draft comments, replies, posts and threads for X (Twitter). The user clicks a button on a post, or types an idea into the popup, and gets a draft to review and post themselves. It never posts on the user's behalf.
```

### Permission justifications

**storage**

```
Stores the user's settings (tone, persona, language, whether sound effects are on), their recent drafts so new drafts do not repeat them, the text in the popup's compose window so it is not lost when the popup closes, a cached copy of their plan and remaining allowance, and the installation's ID and access token for the XAICG server. Everything is kept in chrome.storage.local on the user's device.
```

**identity**

```
Lets the user sign in with their Google account from inside the extension, using Chrome's own account prompt. The extension requests only the basic profile (openid, email, profile) to create the user's XAICG account, so that the free trial is one per person and a license follows them to their other browsers. The Google token is sent to the XAICG server once to confirm who the user is, and is not stored.
```

**clipboardWrite**

```
Copies a draft to the clipboard when the user presses a Copy button, when they choose "Copy a quote-post line", or when they have chosen clipboard mode in settings instead of having drafts typed into the reply box.
```

**Host permissions** (`https://x.com/*`, `https://twitter.com/*`, `https://aigc.uniquelabs.org/*`)

```
x.com and twitter.com: the extension adds its AI Reply and Question buttons to posts on these pages, reads the text of the one post the user clicked, and types the draft into the site's reply box. It runs on no other site.

https://aigc.uniquelabs.org: this is XAICG's own server. The extension sends it the post text and the user's writing settings and receives the draft. It also checks the user's free trial and license there.
```

### Remote code

**No, I am not using remote code.** All JavaScript is inside the package. The server returns text and JSON only, which the extension never executes.

### Data usage

Tick the four marked Yes, and leave the rest unticked:

| Category | Tick | Why |
| --- | --- | --- |
| Personally identifiable information | Yes | Name and email address, when the user signs in with Google |
| Authentication information | Yes | A license key the user types, the installation's access token, and the short-lived Google token used once to sign in |
| Website content | Yes | The text of the post the user asks XAICG to answer |
| Location | Yes | The server sees the user's IP address and keeps a keyed hash of it to limit trial abuse. The store counts an IP address as location data. |
| Health information | No | |
| Financial and payment information | No | Payments happen on your website, not in the extension |
| Personal communications | No | Direct messages are never read |
| Web history | No | |
| User activity | No | No click, scroll or keystroke tracking |

Then tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

These are true of the code as it stands: the only third party that receives anything is OpenAI, which receives the post text in order to write the draft, and that is the extension's single purpose.

### Privacy policy URL

```
https://xaicg.uniquelabs.org/privacy
```

That page is generated from `PRIVACY-POLICY.md`. If you change how data is handled, change the policy, run `node scripts/build-privacy.mjs`, and update the answers above to match.

---

## 4. Distribution tab

| Field | Value |
| --- | --- |
| Visibility | Public |
| Regions | All regions, unless you cannot sell somewhere |
| Payments | If the dashboard asks whether the item has in-app purchases or paid features, say yes: licenses are sold on your website. |

Your publisher account will also ask whether you are a **trader** (a requirement for listing in the EU). Selling licenses is a commercial activity, so the answer is yes, and the contact details you verify are shown on the listing.

---

## 5. Test instructions tab

A reviewer can sign in with any Google account and use the free trial. So that they do not have to, also give them a license key: in the admin dashboard, issue one Pro license with the note "Chrome Web Store review" and paste its key below. You can revoke it after approval.

```
XAICG needs no username or password. There are two ways to test it.

A. With the free trial: click the XAICG icon in the toolbar and press "Sign in with Google". Chrome shows its own account prompt; any Google account works. This starts a free trial of 20 generations.

B. Without signing in, use this license key:

    XAICG-XXXXX-XXXXX-XXXXX-XXXXX

   1. Click the XAICG icon in the toolbar, then Settings.
   2. In the plan card, open "I have a license key", paste the key and press Activate.

To test without an X account:
- Click the XAICG icon. Type an idea (for example "why small weekly releases beat one big launch") and press "Generate posts". Three drafts appear. The Thread and Rewrite tabs work the same way.

To test on X (needs any X account):
- Open https://x.com/home. Each post has "AI Reply" and "Question" buttons in its action bar.
- Press "AI Reply". X's reply box opens with a draft typed in. Nothing is posted until you press X's own Reply button.
- The arrow next to the buttons opens the tone menu.

Notes for the reviewer:
- The extension sends the clicked post's text to our server at https://aigc.uniquelabs.org, which returns the draft. No other page content is read.
- The "identity" permission is used only for the "Sign in with Google" button.
- The extension plays short sound effects, generated in the browser. They can be turned off in Settings under "On x.com".
- All code is in the package. Nothing is downloaded or evaluated at run time.
```

---

## 6. Before you press Submit

- [ ] `node scripts/pack-extension.mjs` ran without complaint (it refuses a build that points at localhost)
- [ ] The extension, loaded unpacked, can sign in, generate a reply on x.com and activate a license against the live server
- [ ] `https://xaicg.uniquelabs.org/privacy` and `https://xaicg.uniquelabs.org/terms` open
- [ ] The reviewer license key in the test instructions works
- [ ] The numbers in the description match the server (`TRIAL_GENERATIONS`, plans) and `website/config.js`

The server should accept only this extension. On Railway, set `ALLOWED_ORIGINS=chrome-extension://lpophlkocboadjhancbdikipnphffgil`: see [SETUP.md](../SETUP.md#9-lock-the-api-to-your-extension).

The website's "Add to Chrome" buttons already point at the listing address above. Until the listing is approved, that address shows the store's error page.
