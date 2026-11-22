# Privacy Policy: X AI Comment/Reply Generator for Twitter (XAICG)

Last updated: November 22, 2026

XAICG ("the extension") is a product of Unique Labs, developed by Shahriar Ahmed. Website: https://uniquelabs.org

This policy explains what the extension does with information, what stays on your computer, and the little that is sent to the XAICG server.

## Summary

- XAICG writes drafts on your own computer, with an AI model that runs there. The post you answer, your settings and your drafts are not sent to us or to anyone else.
- XAICG never posts, likes, follows or sends anything on X on your behalf.
- There is no account and no sign-in. XAICG does not know your name, your email address or your X account.
- To count how many people use it, the extension tells the XAICG server that this install exists, and how many drafts of each kind it wrote. Never what the drafts or the posts say.
- No advertising, no analytics trackers, no sale of data.

## 1. When you ask for a draft

When you press a XAICG button on a post, or use the compose window, the extension reads:

- **The material to write from.** For replies: the text of the post you clicked, its author's handle, and the text of a quoted post, image descriptions and link-card text if present. For original posts, threads and rewrites: the idea or draft you typed.
- **Your voice settings.** Tone, persona text, length, language and emoji preference.
- **A few of your recent drafts**, so new drafts do not repeat them.

All of this is given to the AI model **on your computer**, and the draft is written there. None of it is sent to the XAICG server, to an AI company or to anyone else.

The AI model is downloaded to your computer once, when you press Set up. XAICG sends nothing about you with that download.

## 2. What the XAICG server receives

The XAICG server exists only to count. It receives:

| Data | Form | Purpose |
| --- | --- | --- |
| Install ID | A random ID made by the extension, stored only as a one-way hash | Counting installs, without knowing who they belong to |
| Extension version | As reported by the extension | Knowing which versions are in use |
| Draft counts | The kind of each draft (reply, question, quote, post, thread or rewrite), counted per day | Knowing how much XAICG is used |
| Network | A keyed one-way hash of the IP address an install registered from (IPv6 addresses are reduced to their /64 network first) | Stopping one network from inflating the counts |
| Access token | One-way hash | Letting an install send its counts |

The server never receives the text of a post, a draft, your persona or your settings. It cannot tell who you are or which X account you use. Like any web server, it sees the IP address of each request while handling it; only the keyed hash above is kept.

If the server cannot be reached, XAICG works exactly the same: counts are simply not sent.

## 3. What stays on your computer

Stored with Chrome's extension storage on your device:

- Your settings (tone, persona, length, language, emoji, output mode, sounds)
- Your last 30 drafts, used to avoid repetition. You can clear them at any time in Settings.
- The contents of the compose window, so it is not lost when the popup closes
- The random install ID and access token described above
- Whether the on-device AI is set up

None of this is synced to other devices or sent anywhere. Removing the extension deletes it.

## 4. Who receives data

No one receives your posts, drafts or settings. The counts in section 2 are stored by our hosting and database providers, which run the XAICG server for us. Data is not sold, rented or shared for advertising.

## 5. Browser permissions

- **storage**: saving your settings and the items in section 3.
- **clipboardWrite**: copying a draft when you choose clipboard mode or copy a quote line.
- **Access to x.com and twitter.com**: adding the XAICG buttons to posts, reading the post you chose, and typing the draft into the reply box.
- **Access to the XAICG server**: sending the counts in section 2. The extension does not read your other tabs.

## 6. Your choices

- Use clipboard mode if you do not want the extension to type into X.
- Clear your reply memory in Settings.
- Uninstall the extension at any time. That removes everything it stored on your computer. The counts on the server cannot be linked to you, so there is nothing personal to delete there; if you want an install's counts removed, send us the install's version and the date you installed it and we will do our best.

## 7. Security

Counts are sent to the XAICG server over HTTPS. Install IDs and tokens are stored only as hashes. No method of transmission or storage is perfectly secure.

## 8. This website

This website is hosted by Vercel. It uses no cookies, no analytics and no trackers. Like any web host, Vercel processes your IP address to deliver the pages.

## 9. Children

XAICG is not directed at children under 13 and is not intended for anyone below the minimum age required by X.

## 10. Changes

This policy may be updated. The date at the top shows the latest revision.

## 11. Contact

Help and contact: https://xaicg.uniquelabs.org/support

Unique Labs: https://uniquelabs.org
