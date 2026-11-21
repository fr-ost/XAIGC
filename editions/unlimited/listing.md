# Chrome Web Store listing: XAICG Unlimited

The text for the second store item. Everything not listed here (category, privacy policy address, data usage answers, distribution, the trader question) is the same as the standard edition's, in [`store/listing.md`](../../store/listing.md).

## Package

Upload `dist/xaicg-unlimited-<version>.zip`, made with:

```bash
node scripts/pack-extension.mjs --edition unlimited
```

The name and summary come from `editions/unlimited/edition.json`:

| Field | Value | Limit |
| --- | --- | --- |
| Name | `XAICG Unlimited: On-Device AI Replies for X (Twitter)` | 53 of 75 characters |
| Summary | `Unlimited AI comments and replies for X (Twitter), written on your computer by Chrome's built-in AI. A product of Unique Labs.` | 126 of 132 characters |

## Description

```
XAICG Unlimited writes comments, replies, posts and threads for X (Twitter) in your own voice, with no daily limit. The drafts are written on your own computer by Chrome's built-in AI, so the post you answer never leaves it. You read every draft and post it yourself.

UNLIMITED, ON YOUR COMPUTER
Chrome includes a small AI model that runs on your computer. XAICG Unlimited uses it to write your drafts, so there is no daily limit and no cost. Press Set up once after installing: Chrome downloads the model from Google, and from then on drafts are written right there.
It works in English, Spanish, German, French and Japanese. It needs desktop Chrome on Windows, macOS, Linux or a Chromebook Plus, about 22 GB of free disk space, and either a graphics card with more than 4 GB of memory or 16 GB of memory. If your computer can't run it, or for other languages, the XAICG server writes the draft instead (5 free a day).

HOW IT WORKS
XAICG adds two buttons to every post on x.com: AI Reply and Question. Click one and a draft is typed into X's own reply box. Change it if you like, then press Reply. Nothing is ever posted for you.

WHAT YOU CAN DO
• Reply to any post with one click
• Ask a short, specific question about a post
• Pick a tone: casual, witty, supportive, skeptical, analytical, blunt, technical or professional. Auto picks one to fit the post.
• "Try another" steps through more drafts
• Copy a line for a quote post
• Write original posts and threads from a rough idea, and rewrite your own drafts
• Soft sound effects, which you can switch off

SOUNDS LIKE YOU
Describe your persona once, or start from a preset. XAICG avoids the usual signs of AI writing: no generic praise, no hype words, no hashtags you did not ask for.

PLANS
The on-device AI is free and unlimited. Paid plans add drafts from the XAICG server, which writes better replies and covers every language:
• Starter, $0.99 a month: 60 a day, one browser
• Pro, $1.99 a month: 200 a day, two browsers
• Agency, $4.99 a month: 600 a day, five browsers
Plans are sold at https://xaicg.uniquelabs.org.

PRIVACY
• Drafts written on your computer stay on it: the post and the draft are not sent anywhere
• Drafts written by the XAICG server send the post's text to the server and on to OpenAI; the server does not save it
• XAICG reads only the post you click, never your messages, followers or password
• No advertising, no analytics trackers, no sale of data
Full policy: https://xaicg.uniquelabs.org/privacy

ABOUT
XAICG is a product of Unique Labs (uniquelabs.org), developed by Shahriar Ahmed. It is not affiliated with, endorsed by or sponsored by X Corp or Google. X and Twitter are trademarks of their owner; Chrome and Gemini are trademarks of Google LLC.
```

## Single purpose

```
XAICG Unlimited writes draft comments, replies, posts and threads for X (Twitter), on the user's own computer with Chrome's built-in AI where possible. The user clicks a button on a post, or types an idea into the popup, and gets a draft to review and post themselves. It never posts on the user's behalf.
```

## Permission justifications

Same permissions as the standard edition (`storage`, `identity`, `clipboardWrite`, and the same three hosts). Use the standard edition's text, with this addition to **storage**:

```
Also stores where the user chose drafts to be written (on this computer or on the XAICG server) and whether Chrome's built-in AI is ready on this computer.
```

Chrome's built-in AI (the Prompt API) needs no extra permission.

## Test instructions

```
XAICG Unlimited needs no username or password.

Drafts on this computer (no account needed): after installing, the settings page opens. If the test computer can run Chrome's built-in AI, press "Set up" under "Turn on unlimited comments" and wait for Chrome's one-time download. Then open https://x.com/home and press "AI Reply" on any post: a draft is typed into the reply box, and the message ends with "Written on this computer."

If the computer can't run Chrome's built-in AI, the card says so and drafts come from our server instead: click the XAICG icon and press "Sign in with Google" (any Google account) for 5 free drafts a day, or use this license key in Settings, "I have a license key":

    XAICG-XXXXX-XXXXX-XXXXX-XXXXX

Notes for the reviewer:
- Drafts written on the computer are not sent anywhere. Drafts written by our server send the clicked post's text to https://aigc.uniquelabs.org, which returns the draft.
- Nothing is posted until the user presses X's own Reply button.
- All code is in the package. Nothing is downloaded or evaluated at run time. The AI model is Chrome's own and is downloaded by Chrome.
```
