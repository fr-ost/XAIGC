# Privacy Policy: X AI Comment/Reply Generator for Twitter (XAICG)

Last updated: November 21, 2026

XAICG ("the extension") is a product of Unique Labs, developed by Shahriar Ahmed. Website: https://uniquelabs.org

This policy explains what the extension and the XAICG server process, why, and what is kept.

## Summary

- XAICG writes drafts. It never posts, likes, follows or sends anything on your behalf.
- To write a draft, the text of the post you chose (or the idea or draft you typed) is sent to the XAICG server and on to OpenAI. The XAICG server does not save that text or the generated draft.
- In XAICG Unlimited, drafts can instead be written on your own computer by Chrome's built-in AI. Those drafts, and the post they answer, are not sent anywhere.
- No OpenAI API key is needed from you, and none is stored in the extension.
- If you sign in with Google, XAICG keeps your Google account ID, name and email address, and nothing else from your Google account.
- Your X password, direct messages, followers and other account data are never read.
- No advertising, no analytics trackers, no sale of data.

## 1. What is processed when you generate a draft

When you press a XAICG button on a post, or use the compose window, the extension sends the following to the XAICG server:

- **The material to write from.** For replies: the post's text, the author's handle, the text of a quoted post, image descriptions and link-card text if present. For original posts, threads and rewrites: the idea or draft you typed.
- **Your voice settings.** Tone, persona text, length, language and emoji preference.
- **A few of your recent drafts.** Up to eight, so new drafts do not repeat old ones.

The server forwards this to OpenAI to generate the draft, checks the result with OpenAI's moderation service, and returns it to your browser. **The XAICG server does not store this content in its database and does not write it to its logs.**

### Drafts written on your computer (XAICG Unlimited)

XAICG Unlimited is a second edition of the extension. Where your computer can run it, it writes drafts with the AI model built into Google Chrome, on your computer. For those drafts, nothing described above is sent to the XAICG server or to OpenAI: the material, your voice settings and your recent drafts are given to Chrome's model on your device, and the draft stays there. The XAICG server is not told that a draft was written.

Chrome downloads its model from Google once, when you press Set up. That download is between Chrome and Google; XAICG sends nothing with it. Google's own terms and privacy policy apply to Chrome and its built-in AI.

Drafts that your computer cannot write (for example in a language it does not support), and all drafts if you choose the XAICG server in Settings, are written by the XAICG server as described above. The extension still registers with the XAICG server and checks your plan, as in section 2.

## 2. What the XAICG server stores

| Data | Form | Purpose |
| --- | --- | --- |
| Install ID | One-way hash | Identifies your installation so your free allowance and license follow it |
| Access token | One-way hash | Authenticates your installation's requests |
| IP address | Keyed one-way hash (IPv6 addresses are reduced to their /64 network first) | Limits abuse of the free plan and request flooding |
| X account handle | Hashed in your browser before it is sent, then hashed again with a server key | Stops the daily free allowance being restarted by reinstalling |
| License key | One-way hash, plus a masked hint such as `XAICG-ABCDE-*****-*****-**XYZ` | Validates your license |
| Google account | Google's account ID, your email address and your name, as provided by Google when you sign in | Your XAICG account: one free allowance a day per person, and a license that follows you between browsers |
| Free-use count | A number for the current day, stored under a keyed one-way hash of your Google account ID | One free allowance a day per person. Kept even if the account is deleted, so deleting and signing up again does not reset the day's count. |
| Email address | As provided at purchase, if any | License delivery and support |
| Usage records | Time, type of request, model, token counts, outcome, installation, license | Enforcing plan limits, billing accuracy, abuse detection |

Usage records contain no post text and no generated text. Per-request records are deleted after 60 days. Daily totals are kept for accounting.

Raw IP addresses are held in memory only, for short-lived rate limiting, and are not written to the database.

### Signing in with Google

Signing in happens inside the extension, through Chrome's own Google account prompt. XAICG asks only for your basic profile (`openid`, `email`, `profile`). Chrome gives the extension a short-lived Google access token for the account you chose; the extension sends it to the XAICG server once, and the server uses it to ask Google who you are. Google's answer contains your Google account ID, email address, name, profile picture address and language; XAICG keeps the first three and discards the rest. The token is not stored, on the server or in the extension. XAICG does not receive your password, and it cannot read or change your email, contacts, files or anything else in your Google account. You can remove XAICG's access at any time at https://myaccount.google.com/permissions and sign out in the extension's settings.

## 3. What stays in your browser

Stored with Chrome's extension storage on your device:

- Your settings (tone, persona, language, output mode, and in XAICG Unlimited where drafts are written)
- In XAICG Unlimited, whether Chrome's built-in AI is ready on this computer
- Your last 30 drafts, used to avoid repetition. You can clear them at any time in Settings.
- Your install ID and access token
- A one-way hash of your X handle (never the handle itself)
- If you are signed in, your name and email address, as part of the cached plan below
- A cached copy of your plan and remaining allowance
- The contents of the compose window, so it is not lost when the popup closes

None of this is synced to other devices. Removing the extension deletes it.

## 4. Who receives data

- **OpenAI** receives the material described in section 1 in order to generate and moderate drafts written by the XAICG server (not drafts written on your computer), together with a pseudonymous identifier (a hash, not your name, handle or email) that lets OpenAI attribute misuse to one user rather than to the whole service. OpenAI's handling is governed by its own policies: https://openai.com/policies/privacy-policy
- **Google** handles sign-in if you choose to sign in, under its own privacy policy: https://policies.google.com/privacy
- **Our hosting and database providers** run the XAICG server and store the records in section 2.

Data is not sold, rented or shared for advertising.

## 5. Browser permissions

- **storage**: saving your settings and the items in section 3.
- **clipboardWrite**: copying a draft when you choose clipboard mode or copy a quote line.
- **Access to x.com and twitter.com**: adding the XAICG buttons to posts, reading the post you chose, and typing the draft into the reply box.
- **identity**: showing Chrome's Google account prompt when you choose to sign in.
- **Access to the XAICG server**: sending generation requests and checking your plan and license. The extension does not read your other tabs.

## 6. Your choices

- Use clipboard mode if you do not want the extension to type into X.
- Clear your reply memory in Settings.
- Sign out, or use a license key without signing in at all.
- Ask for your account to be deleted by contacting us with your account email, or the install ID shown under Settings, About. Deleting an account erases your Google account ID, name and email address, including the email on any license. What remains carries none of those: the free-use count described above, your license itself (usable with its key), and usage records.
- Uninstall the extension at any time.

## 7. Security

Traffic between the extension and the XAICG server is encrypted with HTTPS. Tokens, install IDs and license keys are stored only as hashes. No method of transmission or storage is perfectly secure.

## 8. Children

XAICG is not directed at children under 13 and is not intended for anyone below the minimum age required by X.

## 9. Changes

This policy may be updated. The date at the top shows the latest revision.

## 10. Contact

Help and contact: https://xaicg.uniquelabs.org/support

Unique Labs: https://uniquelabs.org
