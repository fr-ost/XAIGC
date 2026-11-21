# XAICG Unlimited

A second edition of the extension. Free users get **unlimited** comments and replies, written on their own computer by Chrome's built-in AI (Gemini Nano, through Chrome's Prompt API). The standard edition in `extension/` is unchanged: it still writes every draft on the XAICG server, with 5 free a day.

The two editions are separate items in the Chrome Web Store, with separate IDs. You can publish either or both.

## How it works

| | Standard edition | XAICG Unlimited |
| --- | --- | --- |
| Free user | XAICG server, 5 a day | **This computer, unlimited** |
| Free user, computer cannot run Chrome's AI | XAICG server, 5 a day | XAICG server, 5 a day |
| Paid plan | XAICG server, plan's daily allowance | XAICG server by default; this computer, unlimited, if they choose it |
| Languages on this computer | n/a | English, Spanish, German, French, Japanese. Others go to the server. |
| Post text sent anywhere | Server and OpenAI | Not when written on this computer |
| Your OpenAI cost | Every draft | Only drafts the server writes |

In Settings the user chooses **Where drafts are written**:

- **Automatic** (the default): on this computer, unless they have a plan. If this computer cannot write a draft (an unsupported language, a post too long, an unusable answer), the server writes it and the message says so.
- **Always on this computer**: unlimited and private, even with a plan. It never falls back to the server; it explains what went wrong instead.
- **Always the XAICG server**: the best drafts, counted against the daily allowance.

### Setting up on a user's computer

Chrome downloads the AI model once, from Google. The settings page that opens after installing shows **Turn on unlimited comments** with a **Set up** button and a progress bar; the popup offers the same. Until it is done, drafts come from the server.

Chrome only offers its AI where the computer can run it. Google's published requirements: desktop Chrome on Windows 10 or 11, macOS 13 or later, Linux, or a Chromebook Plus; about 22 GB of free disk space; and either a graphics card with more than 4 GB of memory, or 16 GB of memory and 4 processor cores. On other computers the card says **Not available on this computer** and the edition behaves like the standard one. Chrome for Android and iOS is not supported.

### Quality

Gemini Nano is far smaller than the model on your server. Drafts written on the computer are shorter on nuance, follow the persona less closely and can be slower on a computer without a graphics card (several seconds to half a minute). They get the same cleanup and ranking as the server's drafts: `scripts/pack-extension.mjs` copies `server/src/engine/parse.js`, `select.js` and `text.js` into the build, so dashes, invented hashtags, generic praise and repeats are filtered the same way.

The prompts for the computer (`extension/lib/device-prompts.js` here) are short ones written for a small model. They are not the server's prompts, which stay on the server. Anything shipped in an extension can be read by anyone who unpacks it, so these prompts should be treated as public.

## What is in this folder

| Path | What it is |
| --- | --- |
| `edition.json` | The edition's store name, summary and Google sign-in client. |
| `extension/lib/ondevice.js` | The engine: checks Chrome's AI, writes drafts with it, cleans and ranks them. Runs in the service worker. |
| `extension/lib/device-prompts.js` | The prompts for the computer. |
| `extension/lib/device-ui.js` | The "on this computer" card in the popup and the settings page, with setup and the choice of where drafts are written. |
| `test/` | Tests, with a stand-in for Chrome's AI. |
| `listing.md` | The Chrome Web Store text for this edition. |

Files in `extension/` here replace or add to the files of the same name in the main `extension/` folder. There, `lib/ondevice.js` and `lib/device-ui.js` are empty placeholders, so the standard edition has none of this code in it.

## Build it

```bash
node scripts/pack-extension.mjs --edition unlimited
```

That writes:

- `dist/xaicg-unlimited/`: the edition, unpacked. Load it at `chrome://extensions` (Developer mode, **Load unpacked**) to try it.
- `dist/xaicg-unlimited-<version>.zip`: the file to upload to the Chrome Web Store.

The standard edition is built as before, with `node scripts/pack-extension.mjs`.

## Test it

```bash
node --test "editions/unlimited/test/*.test.mjs"
```

The tests build the edition into a temporary folder and run the real code with a stand-in for Chrome's AI: the engine, where each draft is written, the fallbacks, and that the standard edition never touches Chrome's AI. They cannot run the real Gemini Nano. Try that on a computer that has it:

1. Build the edition and load `dist/xaicg-unlimited/` in Chrome.
2. In the settings page that opens, press **Set up** and wait for the download.
3. On x.com, press **AI Reply**. The message should end with "Written on this computer." and the button's tooltip should say "Unlimited, written on this computer".
4. Optional: `chrome://on-device-internals` shows Chrome's model and whether it is ready.

## Publish it as a second store item

1. **Reserve the item.** In the Chrome Web Store developer dashboard, add a new item and upload `dist/xaicg-unlimited-<version>.zip`. The dashboard gives it its own ID.
2. **Google sign-in.** A Chrome Extension OAuth client belongs to one extension ID, so this edition needs its own. In Google Cloud, create another OAuth client of type **Chrome Extension** with the new ID (the same way as SETUP.md, Part 5), then:

   ```bash
   node scripts/set-google-client.mjs --edition unlimited <new-client-id>
   ```

   On Railway, add it to `GOOGLE_CLIENT_ID`, after the standard edition's, separated by a comma.
3. **Allow the new ID on the server.** On Railway, add `chrome-extension://<new-id>` to `ALLOWED_ORIGINS`, separated by a comma from the standard edition's.
4. **Rebuild and upload** the zip again (it now carries its own sign-in client), and fill in the listing from `listing.md`.

Until steps 2 and 3 are done, the edition still writes unlimited drafts on the computer, but signing in and the server fallback will fail for it.

## Limits worth knowing

- **There is no limit to enforce, by design.** Drafts written on a computer are not counted anywhere and the server never sees them, so the admin dashboard shows only what the server wrote.
- **Paid plans still matter**: better drafts, every language, and computers that cannot run Chrome's AI.
- **Chrome decides availability.** If Google changes the requirements or the API, this edition falls back to the server rather than breaking.
- Google's Generative AI Prohibited Uses Policy applies to Chrome's built-in AI. The edition only drafts text the person reviews and posts by hand.
