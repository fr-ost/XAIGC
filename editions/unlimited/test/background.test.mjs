// Where XAICG Unlimited writes each draft: on this computer, or on the server.
//
//   node --test "editions/unlimited/test/*.test.mjs"

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fake, send, serverGenerations } from "./fake-chrome.mjs";
import { buildUnlimited, fakeModel } from "./helpers.mjs";

const built = buildUnlimited();
await import(pathToFileURL(path.join(built, "background.js")).href);

const json = (list) => JSON.stringify({ candidates: list });
const goodAnswer = () => json(["Withdrawals included is the part that matters, most fee cuts skip them.", "Cheaper bridging only counts if it stays up on a busy day."]);
const post = { author: "nova", text: "We just cut bridge fees by 80% for every user, starting Monday. Withdrawals included." };
const reply = () => send({ type: "xaicg:generate", payload: { kind: "reply", post } });
const settings = (patch) => chrome.storage.local.set({ settings: { ...(fake.store.settings || {}), ...patch } });
async function useModel(model) {
  globalThis.LanguageModel = model;
  await send({ type: "xaicg:device", fresh: true }); // forget the previous model's answers
  return model;
}

test("free user, model ready: the draft is written here, the server is not asked, nothing is counted", async () => {
  await useModel(fakeModel({ answers: [goodAnswer()] }));
  const before = serverGenerations();
  const res = await reply();
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.engine, "device");
  assert.ok(res.data.variants[0].length > 10);
  assert.equal(serverGenerations(), before);
  assert.deepEqual(
    { engine: fake.store.deviceRoute.engine, state: fake.store.deviceRoute.state },
    { engine: "device", state: "available" },
    "the buttons on x.com learn that drafts are unlimited",
  );
  assert.equal(fake.badge.at(-1), "", "no countdown on the toolbar icon");
});

test("xaicg:device says which edition this is and where drafts go", async () => {
  await useModel(fakeModel());
  const res = await send({ type: "xaicg:device" });
  assert.deepEqual(
    { edition: res.data.edition, engine: res.data.engine, state: res.data.state, setting: res.data.setting },
    { edition: "unlimited", engine: "device", state: "available", setting: "auto" },
  );
  assert.deepEqual(res.data.languages, ["en", "es", "de", "fr", "ja"]);
});

test("model not set up yet: the server writes it, and says why", async () => {
  await useModel(fakeModel({ state: "downloadable" }));
  const before = serverGenerations();
  const res = await reply();
  assert.equal(res.data.engine ?? "server", "server");
  assert.equal(serverGenerations(), before + 1);
  assert.equal(fake.store.deviceRoute.why, "downloadable");
});

test("a language this computer does not write goes to the server, with a note", async () => {
  await useModel(fakeModel());
  await settings({ language: "pt" });
  const before = serverGenerations();
  const res = await reply();
  assert.equal(res.data.engine, "server");
  assert.match(res.data.fallbackNote, /doesn't write this language/);
  assert.equal(serverGenerations(), before + 1);
  await settings({ language: "en" });
});

test("an unusable answer here: the server writes it in Automatic mode", async () => {
  await useModel(fakeModel({ answers: ["", ""] }));
  const res = await reply();
  assert.equal(res.data.engine, "server");
  assert.match(res.data.fallbackNote, /couldn't write this one/);
});

test("'Always on this computer' never falls back: it explains instead", async () => {
  await useModel(fakeModel({ answers: ["", ""] }));
  await settings({ engine: "device" });
  const before = serverGenerations();
  let res = await reply();
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "device_no_usable_output");
  assert.match(res.error.message, /Where drafts are written/);
  await settings({ language: "hi" });
  res = await reply();
  assert.equal(res.error.code, "device_language");
  assert.match(res.error.message, /English, Spanish, German, French and Japanese/);
  assert.equal(serverGenerations(), before, "the server was not used");
  await settings({ engine: "auto", language: "en" });
});

test("a paid plan uses the server by default, and this computer when chosen", async () => {
  fake.account = { ...fake.account, plan: "pro", planLabel: "Pro", licensed: true, quota: { scope: "day", limit: 200, used: 0, remaining: 200 } };
  await send({ type: "xaicg:account", refresh: true });
  await useModel(fakeModel({ answers: [goodAnswer()] }));
  let res = await reply();
  assert.equal(res.data.engine ?? "server", "server");
  assert.equal(fake.store.deviceRoute.why, "plan");

  await settings({ engine: "device" });
  res = await reply();
  assert.equal(res.data.engine, "device");
  await settings({ engine: "auto" });
});

test("'Always the XAICG server' is respected even when the model is ready", async () => {
  fake.account = { ...fake.account, plan: "free", licensed: false, quota: { scope: "free", limit: 5, used: 0, remaining: 5 } };
  await send({ type: "xaicg:account", refresh: true });
  await useModel(fakeModel({ answers: [goodAnswer()] }));
  await settings({ engine: "server" });
  const res = await reply();
  assert.equal(res.data.engine ?? "server", "server");
  assert.equal(fake.store.deviceRoute.why, "setting");
  await settings({ engine: "auto" });
});

test("posts, threads and rewrites from the popup are written here too", async () => {
  await useModel(fakeModel({ answers: [JSON.stringify({ tweets: ["Small weekly releases teach faster.", "Each one is a cheap test."] })] }));
  const res = await send({ type: "xaicg:generate", payload: { kind: "thread", idea: "why small weekly releases beat one big launch", tweets: 3 } });
  assert.equal(res.data.engine, "device");
  assert.equal(res.data.kind, "thread");
  assert.equal(res.data.thread.length, 2);
});
