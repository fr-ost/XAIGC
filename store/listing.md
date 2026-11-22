# Chrome Web Store listing

Everything the developer dashboard asks for, in the order it asks. Text in code blocks is meant to be pasted as it is.

| | |
| --- | --- |
| Store item ID | `lpophlkocboadjhancbdikipnphffgil` |
| Listing address | `https://chromewebstore.google.com/detail/lpophlkocboadjhancbdikipnphffgil` |
| Counting server | `https://aigc.uniquelabs.org` |
| Website | `https://xaicg.uniquelabs.org` |

The images are in [`store/assets/`](assets/). Rebuild them with `node store/generate.mjs` after the extension's look changes.

Nothing users read names the AI model XAICG uses. Keep it that way in anything you add: say "on-device AI" or "an AI model that runs on your computer".

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
| Summary | `Free, unlimited AI comments and replies for X (Twitter), written privately on your computer. No sign-up, no API key.` | 116 of 132 characters |

---

## 2. Store listing tab

### Description

```
X AI Comment/Reply Generator for Twitter (XAICG) is a free AI reply generator for X (Twitter). It drafts comments, replies, posts and threads in your own voice, with no limit, no sign-up and no API key. You read every draft and post it yourself.

FREE AND UNLIMITED
XAICG's AI runs on your own computer, so a draft costs nothing to make. There are no plans, no trial, no credits and no ads. Reply to as many posts as you like, every day.

HOW IT WORKS
After installing, press Set up once: the AI model is downloaded to your computer. Then XAICG adds two buttons to every post on x.com: AI Reply and Question. Click one and a draft is typed into X's own reply box. Change it if you like, then press Reply. Nothing is ever posted for you.

WHAT YOU CAN DO
• Reply to any post with one click
• Ask a short, specific question about a post
• Pick a tone: casual, witty, supportive, skeptical, analytical, blunt, technical or professional. Auto picks one to fit the post.
• "Try another" steps through more drafts, as often as you like
• Copy a line for a quote post
• Write original posts in three lengths from a rough idea
• Turn one idea into a thread of three to eight posts
• Rewrite a draft of your own so it reads better and keeps your facts, names and links
• Write in English, Spanish, German, French or Japanese, or match each post's language
• Soft sound effects when a draft arrives and when you send your reply. Switch them off in Settings if you prefer quiet.

SOUNDS LIKE YOU
Describe your persona once, or start from a preset and edit it. XAICG is built to avoid the usual signs of AI writing: no generic praise, no hype words, no hashtags you did not ask for. It reacts to one concrete detail in the post, the way a person does, and it keeps track of your recent drafts so it does not repeat itself.

PRIVATE BY DESIGN
• The post you answer, your persona and your drafts stay on your computer
• No account, no email, no sign-in
• XAICG reads only the post you click, never your messages, followers or password
• To count its users, XAICG only reports that an install exists and how many drafts of each kind it wrote, never what they say
• No advertising, no analytics trackers, no sale of data
Full policy: https://xaicg.uniquelabs.org/privacy

WHAT YOUR COMPUTER NEEDS
Desktop Chrome on Windows 10 or 11, macOS 13 or later, Linux or a Chromebook Plus; about 22 GB of free disk space; and a graphics card with more than 4 GB of memory, or 16 GB of RAM and 4 processor cores. The settings page tells you straight away if your computer can run it.

Help: https://xaicg.uniquelabs.org/support
Terms: https://xaicg.uniquelabs.org/terms

ABOUT
XAICG is a product of Unique Labs (uniquelabs.org), developed by Shahriar Ahmed.

XAICG is an independent product. It is not affiliated with, endorsed by or sponsored by X Corp. X and Twitter are trademarks of their owner.
```

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
| Screenshot 5 | `store/assets/screenshot-5.png` (free, unlimited, on your computer) | 1280×800 |
| Small promo tile | `store/assets/promo-small.png` | 440×280 |
| Marquee promo tile | `store/assets/promo-marquee.png` | 1400×560 |

Upload the screenshots in this order: the first one is what people see in search results. They show the real extension on a sample timeline with made-up accounts, not X's logo or anyone's real posts.

### Additional fields

| Field | Value |
| --- | --- |
| Homepage URL | `https://xaicg.uniquelabs.org` |
| Support URL | `https://xaicg.uniquelabs.org/support` |
| Official URL | Optional. Needs the site verified in Google Search Console. |
| Mature content | No |

---

## 3. Privacy practices tab

### Single purpose

```
XAICG writes draft comments, replies, posts and threads for X (Twitter) with an AI model that runs on the user's own computer. The user clicks a button on a post, or types an idea into the popup, and gets a draft to review and post themselves. It never posts on the user's behalf.
```

### Permission justifications

**storage**

```
Stores the user's settings (tone, persona, language, whether sound effects are on), their recent drafts so new drafts do not repeat them, the text in the popup's compose window so it is not lost when the popup closes, whether the on-device AI model is set up, and a random install ID with an access token for counting installs. Everything is kept in chrome.storage.local on the user's device.
```

**clipboardWrite**

```
Copies a draft to the clipboard when the user presses a Copy button, when they choose "Copy a quote-post line", or when they have chosen clipboard mode in settings instead of having drafts typed into the reply box.
```

**Host permissions** (`https://x.com/*`, `https://twitter.com/*`, `https://aigc.uniquelabs.org/*`)

```
x.com and twitter.com: the extension adds its AI Reply and Question buttons to posts on these pages, reads the text of the one post the user clicked, and types the draft into the site's reply box. It runs on no other site.

https://aigc.uniquelabs.org: XAICG's own server. The extension reports that the install exists and the kind of each draft written (reply, question, post...), so we can count users. It never sends the text of a post or a draft.
```

### Remote code

**No, I am not using remote code.** All JavaScript is inside the package. The AI model the extension uses is data run by the browser, not code supplied by us, and the server returns only a token.

### Data usage

My reading of the form: data that is processed only on the user's computer is not "collected". The post text and drafts never leave the device, so only the following applies.

| Category | Tick | Why |
| --- | --- | --- |
| Personally identifiable information | No | There is no account, name or email |
| Authentication information | No | Only a random install token, not a credential of the user's |
| Website content | No | The clicked post is read and processed on the device only, never transmitted |
| Location | Yes | The server keeps a keyed hash of the IP address an install registered from, to stop one network inflating the counts. The store counts an IP address as location data. |
| User activity | No | Only a count of drafts by kind; no clicks, scrolls or keystrokes |
| Health, financial, personal communications, web history | No | |

If a reviewer reads "website content" more widely, tick it and add: "read on the device to write a draft; never transmitted."

Then tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

```
https://xaicg.uniquelabs.org/privacy
```

That page is generated from `PRIVACY-POLICY.md`. If you change how data is handled, change the policy, run `node scripts/build-site.mjs`, and update the answers above to match.

---

## 4. Distribution tab

| Field | Value |
| --- | --- |
| Visibility | Public |
| Regions | All regions |
| Payments | None. The extension is free and has no in-app purchases. |

The publisher account may ask whether you are a **trader** (for listing in the EU). A free product with no sales may not need it; answer according to how Unique Labs operates.

---

## 5. Test instructions tab

```
XAICG needs no username, password or license.

Setup: after installing, the settings page opens. Under "One step left: set up the AI", press "Set up" and wait for the one-time download of the on-device AI model (a progress bar shows it). When the card says "Ready: free and unlimited", XAICG is ready.

The on-device model needs desktop Chrome 138 or later on Windows, macOS, Linux or a Chromebook Plus, about 22 GB of free disk space, and a graphics card with more than 4 GB of memory or 16 GB of RAM. On a computer that cannot run it, the settings page says "Not available on this computer" and lists these requirements.

To test without an X account:
- Click the XAICG icon. Type an idea (for example "why small weekly releases beat one big launch") and press "Generate posts". Three drafts appear. The Thread and Rewrite tabs work the same way.

To test on X (needs any X account):
- Open https://x.com/home. Each post has "AI Reply" and "Question" buttons in its action bar.
- Press "AI Reply". X's reply box opens with a draft typed in. Nothing is posted until you press X's own Reply button.
- The arrow next to the buttons opens the tone menu.

Notes for the reviewer:
- Drafts are written on the device. The post text and the drafts are never sent anywhere.
- The extension reports to https://aigc.uniquelabs.org only that the install exists and the kind of each draft written, for counting users.
- All code is in the package. Nothing is downloaded and evaluated at run time.
```

---

## 6. Before you press Submit

- [ ] `node scripts/pack-extension.mjs` ran without complaint (it refuses a build that reports to localhost)
- [ ] The extension, loaded unpacked on a capable computer, sets up the AI and writes a reply on x.com
- [ ] `https://xaicg.uniquelabs.org/privacy`, `/terms` and `/support` open
- [ ] The counting server is deployed and its admin dashboard shows the test install

The server should accept counts only from this extension. On Railway, set `ALLOWED_ORIGINS=chrome-extension://lpophlkocboadjhancbdikipnphffgil`: see [SETUP.md](../SETUP.md).
