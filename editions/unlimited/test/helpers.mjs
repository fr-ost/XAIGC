// Shared by the Unlimited edition's tests.
//
// buildUnlimited() packs the edition into a temporary folder (the same way
// the store build is made) and returns its path. fakeModel() stands in for
// Chrome's built-in model: these tests run in Node, where there is none.

import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function buildUnlimited() {
  const out = mkdtempSync(path.join(tmpdir(), "xaicg-unlimited-"));
  execFileSync(process.execPath, [path.join(root, "scripts", "pack-extension.mjs"), "--edition", "unlimited", "--no-zip", "--out", out], { stdio: "pipe" });
  return out;
}

// A stand-in for the global `LanguageModel`. `answers` is a list of replies,
// each a string or a function (prompt, options) => string, or an Error to throw.
export function fakeModel({ state = "available", answers = [], params = { defaultTopK: 3, maxTopK: 128, defaultTemperature: 1, maxTemperature: 2 } } = {}) {
  const model = {
    state,
    answers,
    created: [],
    prompts: [],
    destroyed: 0,
    availabilityCalls: [],
    async availability(options) {
      model.availabilityCalls.push(options);
      return typeof model.state === "function" ? model.state(options) : model.state;
    },
    async params() {
      return params;
    },
    async create(options = {}) {
      model.created.push(options);
      return {
        async prompt(text, opts = {}) {
          model.prompts.push({ text, opts });
          const next = model.answers.shift();
          if (next instanceof Error) throw next;
          return typeof next === "function" ? next(text, opts) : (next ?? "");
        },
        destroy() {
          model.destroyed++;
        },
      };
    },
  };
  return model;
}

export const domError = (name, message = name) => Object.assign(new Error(message), { name });
