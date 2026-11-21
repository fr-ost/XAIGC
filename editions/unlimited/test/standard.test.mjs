// The standard edition is not changed by the Unlimited one: even with
// Chrome's model present, every draft goes to the server and nothing about
// "on this computer" is stored or shown.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fake, send, serverGenerations } from "./fake-chrome.mjs";
import { fakeModel, root } from "./helpers.mjs";

globalThis.LanguageModel = fakeModel({ answers: ['{"candidates":["should never be used"]}'] });
await import(path.join(root, "extension", "background.js"));

test("every draft is written by the server", async () => {
  const res = await send({ type: "xaicg:generate", payload: { kind: "reply", post: { author: "a", text: "Something worth replying to, with a detail." } } });
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.variants, ["A draft from the server."]);
  assert.equal(res.data.engine, undefined);
  assert.equal(serverGenerations(), 1);
  assert.equal(globalThis.LanguageModel.created.length, 0, "the built-in model is never touched");
  assert.equal(fake.store.deviceRoute, undefined);
});

test("it reports itself as the standard edition", async () => {
  const res = await send({ type: "xaicg:device" });
  assert.deepEqual({ edition: res.data.edition, engine: res.data.engine }, { edition: "standard", engine: "server" });
});

test("its package holds no on-device code", async () => {
  const stub = await readFile(path.join(root, "extension", "lib", "ondevice.js"), "utf8");
  assert.match(stub, /export const onDevice = null;/);
  assert.ok(!stub.includes("LanguageModel"));
  const ui = await readFile(path.join(root, "extension", "lib", "device-ui.js"), "utf8");
  assert.ok(!ui.includes("LanguageModel"));
});
