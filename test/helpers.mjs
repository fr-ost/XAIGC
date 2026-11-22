// Shared by the extension's tests. fakeModel() stands in for Chrome's
// built-in model: these tests run in Node, where there is none.

import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const extension = (...parts) => path.join(root, "extension", ...parts);

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
