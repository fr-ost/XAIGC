// XAICG website settings. This is the one file to edit; no build step.
//
// The numbers here are what the page tells visitors, so keep them equal to
// what the server enforces (TRIAL_GENERATIONS and the plans, see
// server/.env.example).
window.XAICG_SITE = {
  // The extension's Chrome Web Store address. With it empty (""), the "Add to
  // Chrome" buttons read "Coming soon to Chrome" instead. The store shows an
  // error page at this address until the listing has been approved.
  chromeStoreUrl: "https://chromewebstore.google.com/detail/lpophlkocboadjhancbdikipnphffgil",

  // Where people buy a license, and where they get help.
  // Where people buy a license. Until there is a checkout, this is where they reach you.
  buyUrl: "https://uniquelabs.org",
  // "Support" links lead to the help page on this site.
  supportUrl: "/support",
  // How people reach you from that page. Put an email address here and its
  // button becomes "Email <address>"; leave it empty to send people to
  // contactUrl instead.
  supportEmail: "",
  contactUrl: "https://uniquelabs.org",

  // Free generations for a new account.
  trialGenerations: 20,

  // Paid plans. `price` is shown as written, for example "$9" with
  // period "per month". Leave price empty to show the plan without one.
  plans: [
    { name: "Starter", perDay: 60, devices: 1, price: "$0.99", period: "per month" },
    { name: "Pro", perDay: 200, devices: 2, price: "$1.99", period: "per month", featured: true },
    { name: "Agency", perDay: 600, devices: 5, price: "$4.99", period: "per month" },
  ],
};
