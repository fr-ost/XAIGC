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

About 8,000 characters (the store allows 16,000). The same text is in [`description.txt`](description.txt) for copying. It names no AI model and repeats no keyword lists.

```
XAICG is a free AI reply generator for X (Twitter). It adds an AI Reply button to every post, writes a comment that sounds like you, and types it into the reply box so you can read it, edit it and post it yourself. Free forever, with no daily limit, no sign-up and no API key. Your drafts are written privately on your own computer.

Replying is how people get noticed on X, but finding something worth saying to every post takes time. XAICG removes the blank box. You choose the posts, you decide what you think, and the first draft is ready in a moment.

FREE, UNLIMITED AND PRIVATE
Most AI writing tools send your text to a server and pay for every request, so they limit you or charge you. XAICG's AI runs on your computer instead. A draft costs nothing to make, so there are no plans, no credits, no trial and no ads. Reply to as many posts as you like, every day.
Because the writing happens on your device, the post you answer, your persona and your drafts never leave your computer.

HOW IT WORKS
1. Add XAICG to Chrome.
2. Press Set up once. The AI model is downloaded to your computer, which takes a few minutes.
3. Open x.com. Every post now has an AI Reply button and a Question button.
4. Click one. A draft appears in X's reply box. Change anything you like and press Reply.
Nothing is ever posted for you. Every comment goes out because you sent it.

WHAT YOU CAN DO

AI replies and comments
• One click on any post writes a reply that reacts to a specific detail in it, the way a person would.
• Each click brings back several drafts. Press "Try another" to step through them, as often as you like.
• Replies are typed straight into X's own reply box, so you can edit them in place.

Sharp questions
• The Question button writes one short, specific question about the post. Good questions are among the easiest replies to answer, which makes them a simple way to start a conversation.
• Generic questions like "Thoughts?" are filtered out.

Tones for every post
• Auto picks a tone that fits each post.
• Or choose casual, witty, supportive, skeptical, analytical, blunt, technical or professional from the menu next to the buttons.

Quote posts
• Copy a line for a quote post: your own comment that makes sense on its own above the post you are quoting.

Posts, threads and rewrites
• Open XAICG from Chrome's toolbar and describe an idea in a sentence or two.
• Get post drafts in three lengths, ready to copy or open in X.
• Turn one idea into a thread of three to eight posts, with a clear first post and an ending that lands the point.
• Paste a draft of your own and get tighter versions that keep your facts, names, numbers and links.

SOUNDS LIKE YOU, NOT LIKE AN ASSISTANT
The biggest problem with AI replies is that they all sound the same. XAICG is built to avoid the usual signs of machine writing:
• No generic praise such as "Great point" or "Love this"
• No hype words, no long dashes, no hashtags or links you did not ask for
• No summarizing the post back to its author
• Short, plain sentences that react to one concrete detail
It also keeps your last 30 drafts on your computer and steers new ones away from repeating their openings and phrasing, so a week of replies does not read like one template.

Make it yours in Settings:
• Describe your voice in your own words, or start from a preset: Skeptical trader, Blunt founder, Developer, Witty, Analytical or Supportive realist.
• Choose a default tone and a reply length: short (4 to 12 words), medium (8 to 22) or long (18 to 40).
• Decide on emoji: never, at most one, or only when the post has them.

LANGUAGES
XAICG writes in English, Spanish, German, French and Japanese. Pick one, or have it match the language of each post.

YOUR WAY OF WORKING
• Type into the reply box, or copy to the clipboard only, if you would rather paste drafts yourself and leave the page untouched.
• Show or hide the Question button.
• Soft sound effects when a draft starts, when it arrives and when you send your reply. Switch them off in one click.
• Clear your reply memory at any time.

WHO USES IT
• Creators and writers who reply every day to grow their audience
• Founders and builders who want to show up in their industry's conversations without losing hours to it
• Marketers, community managers and social media teams who answer many posts across a day
• People in fast-moving circles, such as tech, AI and crypto, where timely replies matter
• Anyone writing on X in a second language who wants a clean first draft to start from
• Anyone who knows what they want to say and wants to say it faster

TIPS FOR BETTER REPLIES
• Reply where you have something to add: an experience, a fact, a real question or an honest disagreement.
• Describe your voice in Settings. A few lines about how you write, and what you never say, change the drafts more than anything else.
• Add the one thing only you know before you post: a number, a name, what happened when you tried it.
• Keep it short. One or two sentences is the natural size of a reply.
More guides are on the XAICG blog: https://xaicg.uniquelabs.org/blog

PRIVACY
• Drafts are written on your computer. The post you answer, your settings and your drafts are not sent to us or to anyone else.
• No account, no email address, no sign-in.
• XAICG reads only the post you click. It never reads your messages, your followers or your password, and it cannot post, like or follow for you.
• To know how many people use it, XAICG reports only that an install exists and how many drafts of each kind it wrote, never what they say.
• No advertising, no analytics trackers, no sale of data.
Full policy: https://xaicg.uniquelabs.org/privacy

WHAT YOUR COMPUTER NEEDS
The AI runs on your own computer, so it needs a reasonably capable one:
• Desktop Google Chrome on Windows 10 or 11, macOS 13 or later, Linux, or a Chromebook Plus
• About 22 GB of free disk space
• A graphics card with more than 4 GB of memory, or 16 GB of memory and 4 processor cores
The settings page tells you straight away whether your computer can run it. Chrome on phones and tablets is not supported.

QUESTIONS PEOPLE ASK

Is XAICG really free?
Yes, free forever, with every feature included. There is no paid version.

Is there a daily limit?
No. Reply to as many posts as you want.

Do I need an account or an OpenAI API key?
No. Install it, press Set up once, and start replying.

Does it work on twitter.com too?
Yes. The buttons appear on x.com and twitter.com, in the timeline, on single posts and in replies.

Can I use it for my own posts, not only replies?
Yes. The toolbar popup writes original posts and full threads from a rough idea, and rewrites your own drafts.

Does it post automatically?
Never. It only writes drafts. You read each one and press Reply yourself.

Is it safe for my X account?
XAICG does not automate anything: no bulk replies, no scheduling, no auto-posting. Every reply is one you chose to send by hand. X's rules still apply to what you post, so use it to write better replies, not more spam.

Why does it download something?
The AI model has to be on your computer to write there. It is downloaded once, when you press Set up.

Will it work offline?
Once it is set up, drafts are written on your computer without needing an internet connection. You still need a connection to use X itself.

RESPONSIBLE USE
XAICG is a writing assistant, not a bot. It writes one draft at a time, on the post you clicked, and waits for you. You are responsible for what you post. Read every draft before sending it, and check any fact it states.

HELP AND CONTACT
Help: https://xaicg.uniquelabs.org/support
FAQ: https://xaicg.uniquelabs.org/faq
Terms: https://xaicg.uniquelabs.org/terms

XAICG (X AI Comment/Reply Generator for Twitter) is a product of Unique Labs (uniquelabs.org), developed by Shahriar Ahmed.

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
| Screenshot 5 | `store/assets/screenshot-5.png` (written on your computer) | 1280×800 |
| Small promo tile | `store/assets/promo-small.png` | 440×280 |
| Marquee promo tile | `store/assets/promo-marquee.png` | 1400×560 |

Upload the screenshots in this order: the first one is what people see in search results. They show the real extension on a sample timeline with made-up accounts, not X's logo or anyone's real posts.

**Keep promotional words out of the images.** The Chrome Web Store rejects images (screenshots, promo tiles, icon) that carry badges or text such as "free", "free forever", "$0", "unlimited", "new", "#1", "recommended" or "premium" (violation "Red Nickel": mimicking ranking, performance, status or promotional information). Version 4.0.0 was rejected for a "Free forever" badge. The images now describe features only, and the extension's own screens no longer show a "Free" badge, so screenshots of them stay clean. Saying the extension is free belongs in the description text, in plain sentences.

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

Setup: after installing, the settings page opens. Under "One step left: set up the AI", press "Set up" and wait for the one-time download of the on-device AI model (a progress bar shows it). When the card says "Ready to write", XAICG is ready.

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
