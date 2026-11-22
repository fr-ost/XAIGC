// The extension's service worker: drafts are written on this computer, and
// the server only ever hears "an install exists" and "a draft of this kind".
//
//   node --test "test/*.test.mjs"

import { test } from "node:test";
import assert from "node:assert/strict";
import { fake, reports, send, settle } from "./fake-chrome.mjs";
import { fakeModel } from "./helpers.mjs";

await import("../extension/background.js");

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

test("installing opens the welcome page and counts the install", async () => {
  await useModel(fakeModel({ state: "downloadable" }));
  await fake.listeners.installed({ reason: "install" });
  assert.match(fake.tabs[0].url, /options\.html#welcome$/);
  const register = fake.calls.find((c) => c.path === "/v1/devices");
  assert.ok(register, "the install is counted");
  assert.deepEqual(Object.keys(register.body), ["installId"], "with a random id and nothing else");
  assert.equal(register.headers["X-XAIGC-Client"], "4.0.0");
  assert.equal(fake.store.deviceToken, "xd_1");
  assert.equal(fake.badge.at(-1), "!", "the icon shows there is one step left");
});

test("a draft is written here, and only its kind is reported", async () => {
  await useModel(fakeModel({ answers: [goodAnswer()] }));
  const res = await reply();
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.kind, "reply");
  assert.ok(res.data.variants[0].length > 10);
  await settle();
  const sent = reports().at(-1);
  assert.deepEqual(sent.body, { kind: "reply" });
  assert.equal(sent.headers.Authorization, "Bearer xd_1");
  const everything = JSON.stringify(fake.calls);
  assert.ok(!everything.includes("bridge fees") && !everything.includes("Withdrawals"), "neither the post nor the draft is sent anywhere");
  assert.equal(fake.store.deviceStatus.state, "available");
  assert.equal(fake.badge.at(-1), "", "no badge once it is ready");
});

test("the server being down changes nothing for the person", async () => {
  await useModel(fakeModel({ answers: [goodAnswer()] }));
  fake.serverDown = true;
  const res = await reply();
  fake.serverDown = false;
  assert.equal(res.ok, true);
  assert.equal(res.data.variants.length >= 1, true);
});

test("a forgotten token: the install registers again, once, and the count goes through", async () => {
  await useModel(fakeModel({ answers: [goodAnswer()] }));
  fake.forgotten.add(fake.store.deviceToken);
  const before = reports().length;
  await reply();
  await settle();
  assert.equal(reports().length, before + 2, "refused once, then sent with the new token");
  assert.notEqual(reports().at(-1).headers.Authorization, reports().at(-2).headers.Authorization);
});

test("not set up yet: a clear error, nothing counted", async () => {
  await useModel(fakeModel({ state: "downloadable" }));
  const before = reports().length;
  const res = await reply();
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "device_not_ready");
  assert.match(res.error.message, /Set up/);
  await settle();
  assert.equal(reports().length, before);
});

test("this computer cannot run it: says so", async () => {
  await useModel(fakeModel({ state: "unavailable" }));
  const res = await reply();
  assert.equal(res.error.code, "device_unavailable");
  assert.match(res.error.message, /can't run on this computer/);
  delete globalThis.LanguageModel;
  await send({ type: "xaicg:device", fresh: true });
  const old = await reply();
  assert.equal(old.error.code, "device_unavailable");
  assert.match(old.error.message, /Update Chrome/);
});

test("a language it does not write: says which ones it does", async () => {
  await useModel(fakeModel());
  await settings({ language: "auto" });
  const res = await send({ type: "xaicg:generate", payload: { kind: "reply", post: { author: "a", text: "Мы снизили комиссии на 80% для всех пользователей" } } });
  assert.equal(res.error.code, "device_language");
  assert.match(res.error.message, /English, Spanish, German, French and Japanese/);
  await settings({ language: "en" });
});

test("drafts are written one at a time", async () => {
  let running = 0;
  let most = 0;
  const slow = () =>
    new Promise((resolve) => {
      running++;
      most = Math.max(most, running);
      setTimeout(() => {
        running--;
        resolve(goodAnswer());
      }, 15);
    });
  await useModel(fakeModel({ answers: [slow, slow, slow] }));
  const results = await Promise.all([reply(), reply(), reply()]);
  assert.ok(results.every((r) => r.ok));
  assert.equal(most, 1);
});

test("posts, threads and rewrites from the popup are written here too", async () => {
  await useModel(fakeModel({ answers: [JSON.stringify({ tweets: ["Small weekly releases teach faster.", "Each one is a cheap test."] })] }));
  const res = await send({ type: "xaicg:generate", payload: { kind: "thread", idea: "why small weekly releases beat one big launch", tweets: 3 } });
  assert.equal(res.data.kind, "thread");
  assert.equal(res.data.thread.length, 2);
  await settle();
  assert.deepEqual(reports().at(-1).body, { kind: "thread" });
});

test("what the popup and settings page can ask", async () => {
  await useModel(fakeModel());
  assert.deepEqual((await send({ type: "xaicg:device" })).data, { state: "available", languages: ["en", "es", "de", "fr", "ja"] });
  assert.deepEqual((await send({ type: "xaicg:info" })).data, { version: "4.0.0" });
  for (const gone of ["xaicg:account", "xaicg:signin", "xaicg:activate", "xaicg:open-plans"]) {
    assert.equal(await send({ type: gone }), undefined, `${gone} no longer exists`);
  }
});
