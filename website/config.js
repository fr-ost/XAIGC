// XAICG website settings. This is the one file to edit; no build step.
//
// The numbers here are what the page tells visitors, so keep them equal to
// what the server enforces (TRIAL_GENERATIONS and the plans, see
// server/.env.example).
window.XAICG_SITE = {
  // The extension's Chrome Web Store address. Until it is set, the "Add to
  // Chrome" buttons read "Coming soon to Chrome".
  chromeStoreUrl: "",

  // Where people buy a license, and where they get help.
  buyUrl: "https://uniquelabs.org",
  supportUrl: "https://uniquelabs.org",

  // Free generations for a new account.
  trialGenerations: 20,

  // Paid plans. `price` is shown as written, for example "$9" with
  // period "per month". Leave price empty to show the plan without one.
  plans: [
    { name: "Starter", perDay: 60, devices: 1, price: "", period: "" },
    { name: "Pro", perDay: 200, devices: 2, price: "", period: "", featured: true },
    { name: "Agency", perDay: 600, devices: 5, price: "", period: "" },
  ],
};
