---
title: Before You Install a Chrome Extension for X: A Safety Check
description: Extensions for X can read what you read. A short checklist covering permissions, site access, API keys, the privacy policy and who makes it.
date: 2026-11-14
updated: 2026-11-22
tag: Privacy
related: is-it-safe-to-use-ai-replies-on-x, ai-reply-generator-for-x-guide, how-to-write-better-replies-on-x
---

A Chrome extension that works on X runs inside the page. Depending on what it was given permission to do, it can read the posts on your screen, the text you type and, in the worst case, far more than that. Most extensions are honest. The point of this checklist is that you can tell, in about five minutes, before you click Add to Chrome.

## 1. Check which sites it runs on

When you add an extension, Chrome shows what it will be able to do. The line to read first is about sites:

- **"Read and change your data on x.com"** means it works on X only. That is what a tool for X should ask for.
- **"Read and change all your data on all websites"** means it can run on your bank, your email and everything else. A tool for X has no need of that.

After installing, you can look again. Open `chrome://extensions`, choose Details on the extension and find **Site access**. Chrome lets you restrict an extension to specific sites there.

## 2. Read the permission list

The Chrome Web Store listing and the install prompt name the permissions. A few that deserve a second look in a tool for X:

- **Browsing history** or **tabs** access. Not needed to write a reply.
- **Cookies.** Session cookies are how you stay logged in. An extension that can read them for x.com could act as you.
- **Clipboard read.** Writing to the clipboard, to copy a draft, is normal. Reading it is not needed.
- **Web requests on all sites.** This lets an extension watch your traffic.

A short list with an obvious reason for each item is a good sign.

## 3. See what the developer declares about data

Each listing on the Chrome Web Store has a section on privacy practices, where the developer must state what data is collected and how it is used. Read it, and compare it with the privacy policy. Look for three plain statements:

- what is read from the page
- what is sent to a server, and whether it is stored
- whether the AI runs on a server or on your computer
- whether data is sold or used for advertising

If the listing says one thing and the policy another, or if there is no policy at all, stop there.

## 4. Never give an extension your X password

A reply or writing tool has no reason to know your password. Anything that asks you to type your X login into its own window, rather than using X's normal sign-in, is to be avoided, whatever it promises.

## 5. Think twice about pasting an API key

Some AI tools ask for your own OpenAI key. It works, and it has costs you should know about:

- The key is stored in your browser, where a bug or another extension might expose it.
- The bill is yours, and depends on how much you click.
- If the key leaks, someone else can spend your money.

Tools that run the model themselves avoid all three, whether on their own server or on your computer. If you do use a key, create one only for that tool and set a spending limit on it.

## 6. Ask whether it acts for you

There is a real difference between an extension that suggests and one that acts. A tool that types a draft into the reply box and waits is a suggestion. A tool that posts, likes, follows or sends messages on a schedule is acting as you, and X's rules on automation then apply to your account. We cover that in [is it safe to use AI for replies on X](/blog/is-it-safe-to-use-ai-replies-on-x).

## 7. Find out who makes it

Scroll to the bottom of the listing. A trustworthy extension usually has:

- a developer name that leads to a real website
- a contact address or support page
- a privacy policy on the developer's own domain
- a history of updates

In some regions the store also shows whether the developer has declared themselves a trader, with verified contact details.

## 8. Prefer code that ships in the package

Chrome's current extension format, Manifest V3, does not allow extensions to download and run new code from a server. That closes off a class of abuse in which an extension behaves well at review and changes afterward. It does not make every extension safe, but an extension built on the current format is one more thing in its favor.

## 9. Review what you have installed

Once or twice a year, open `chrome://extensions` and remove what you no longer use. An extension you forgot about still has the permissions you gave it, and extensions sometimes change owners.

## The five-minute version

1. It runs only on x.com and twitter.com.
2. Its permission list is short and each item makes sense.
3. Its privacy practices and its policy agree, and say that data is not sold.
4. It does not ask for your X password.
5. It never posts without you.
6. There is a company and a way to reach it.

## How XAICG answers this checklist

This is our own extension, so check it against the list yourself.

- **Sites:** x.com and twitter.com, plus its own server, which only counts installs and drafts. Nothing else.
- **Permissions:** storage, for your settings and recent drafts on your device, and clipboard write, for the Copy buttons. No sign-in.
- **What it reads:** the one post you click. Not your messages, followers or password.
- **Where it writes:** on your computer, with on-device AI. The post and the draft are not sent anywhere. The server is told that an install exists and how many drafts of each kind it wrote, never what they say. The [privacy policy](/privacy) has the details.
- **API key and account:** none.
- **Acting for you:** never. A draft waits in the reply box until you press Reply.
- **Who makes it:** Unique Labs. There is a [support page](/support) and a [contact page](/contact).
- **Code:** everything is in the package. Nothing is downloaded and run later.

Five minutes of reading before you install is a small price for a tool that sits inside the pages you read every day. If you are choosing an AI reply tool specifically, [what to check in an AI reply generator](/blog/ai-reply-generator-for-x-guide) goes into the writing side.
