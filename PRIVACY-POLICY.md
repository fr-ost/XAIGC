# Privacy Policy: XAIGC, AI Content Generator for X

Last updated: November 14, 2026

XAIGC ("the extension") is a product of Unique Labs, developed by Shahriar Ahmed. Website: https://uniquelabs.org

This policy explains what the extension and the XAIGC server process, why, and what is kept.

## Summary

- XAIGC writes drafts. It never posts, likes, follows or sends anything on your behalf.
- To write a draft, the text of the post you chose (or the idea or draft you typed) is sent to the XAIGC server and on to OpenAI. The XAIGC server does not save that text or the generated draft.
- No OpenAI API key is needed from you, and none is stored in the extension.
- Your X password, direct messages, followers and other account data are never read.
- No advertising, no analytics trackers, no sale of data.

## 1. What is processed when you generate a draft

When you press a XAIGC button on a post, or use the compose window, the extension sends the following to the XAIGC server:

- **The material to write from.** For replies: the post's text, the author's handle, the text of a quoted post, image descriptions and link-card text if present. For original posts, threads and rewrites: the idea or draft you typed.
- **Your voice settings.** Tone, persona text, length, language and emoji preference.
- **A few of your recent drafts.** Up to eight, so new drafts do not repeat old ones.

The server forwards this to OpenAI to generate the draft, checks the result with OpenAI's moderation service, and returns it to your browser. **The XAIGC server does not store this content in its database and does not write it to its logs.**

## 2. What the XAIGC server stores

| Data | Form | Purpose |
| --- | --- | --- |
| Install ID | One-way hash | Identifies your installation so your trial and license follow it |
| Access token | One-way hash | Authenticates your installation's requests |
| IP address | Keyed one-way hash (IPv6 addresses are reduced to their /64 network first) | Limits free-trial abuse and request flooding |
| X account handle | Hashed in your browser before it is sent, then hashed again with a server key | Stops the free trial being restarted by reinstalling |
| License key | One-way hash, plus a masked hint such as `XAIGC-ABCDE-*****-*****-**XYZ` | Validates your license |
| Email address | As provided at purchase, if any | License delivery and support |
| Usage records | Time, type of request, model, token counts, outcome, installation, license | Enforcing plan limits, billing accuracy, abuse detection |

Usage records contain no post text and no generated text. Per-request records are deleted after 60 days. Daily totals are kept for accounting.

Raw IP addresses are held in memory only, for short-lived rate limiting, and are not written to the database.

## 3. What stays in your browser

Stored with Chrome's extension storage on your device:

- Your settings (tone, persona, language, output mode)
- Your last 30 drafts, used to avoid repetition. You can clear them at any time in Settings.
- Your install ID and access token
- A one-way hash of your X handle (never the handle itself)
- A cached copy of your plan and remaining allowance
- The contents of the compose window, so it is not lost when the popup closes

None of this is synced to other devices. Removing the extension deletes it.

## 4. Who receives data

- **OpenAI** receives the material described in section 1 in order to generate and moderate drafts, together with a pseudonymous identifier (a hash, not your name, handle or email) that lets OpenAI attribute misuse to one user rather than to the whole service. OpenAI's handling is governed by its own policies: https://openai.com/policies/privacy-policy
- **Our hosting provider** runs the XAIGC server and its database.

Data is not sold, rented or shared for advertising.

## 5. Browser permissions

- **storage**: saving your settings and the items in section 3.
- **clipboardWrite**: copying a draft when you choose clipboard mode or copy a quote line.
- **Access to x.com and twitter.com**: adding the XAIGC buttons to posts, reading the post you chose, and typing the draft into the reply box.
- **Access to the XAIGC server**: sending generation requests.

## 6. Your choices

- Use clipboard mode if you do not want the extension to type into X.
- Clear your reply memory in Settings.
- Ask for your server-side records to be deleted by contacting us with the install ID shown under Settings, About.
- Uninstall the extension at any time.

## 7. Security

Traffic between the extension and the XAIGC server is encrypted with HTTPS. Tokens, install IDs and license keys are stored only as hashes. No method of transmission or storage is perfectly secure.

## 8. Children

XAIGC is not directed at children under 13 and is not intended for anyone below the minimum age required by X.

## 9. Changes

This policy may be updated. The date at the top shows the latest revision.

## 10. Contact

Unique Labs: https://uniquelabs.org
