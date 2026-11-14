// XAICG website settings: the one place for the site's addresses, numbers
// and prices.
//
// The pages are built from this file. After changing anything here, run
//
//   node scripts/build-site.mjs
//
// and commit the result. (The four addresses below, chromeStoreUrl, buyUrl,
// supportEmail and contactUrl, are also read by the pages as they load, so a
// change to one of those shows up even before a rebuild.)
//
// Keep the numbers equal to what the server enforces: FREE_DAILY_LIMIT and
// the plans, see server/.env.example.
window.XAICG_SITE = {
  // The site's own public address, without a slash at the end. It goes into
  // the links that search engines and link previews need in full.
  siteUrl: "https://xaicg.uniquelabs.org",

  // Search engines ask you to prove the site is yours before they show you
  // how it is doing in search. Each gives you a code (choose the "HTML tag"
  // method): paste the code alone here, rebuild and push, then press Verify.
  googleSiteVerification: "",
  bingSiteVerification: "",

  // The extension's Chrome Web Store address. With it empty (""), the "Add to
  // Chrome" buttons read "Coming soon to Chrome" instead. The store shows an
  // error page at this address until the listing has been approved.
  chromeStoreUrl: "https://chromewebstore.google.com/detail/lpophlkocboadjhancbdikipnphffgil",

  // Where people buy a license. Until there is a checkout, this is where they reach you.
  buyUrl: "https://uniquelabs.org",
  // "Support" links lead to the help page on this site.
  supportUrl: "/support",
  // How people reach you from the contact and support pages. Put an email
  // address here and their button becomes "Email <address>"; leave it empty
  // to send people to contactUrl instead.
  supportEmail: "",
  contactUrl: "https://uniquelabs.org",

  // The free plan: comments a day, for everyone, for nothing.
  freePerDay: 5,

  // Paid plans. `price` is shown as written, for example "$9" with
  // period "per month". Leave price empty to show the plan without one.
  plans: [
    { name: "Starter", perDay: 60, devices: 1, price: "$0.99", period: "per month" },
    { name: "Pro", perDay: 200, devices: 2, price: "$1.99", period: "per month", featured: true },
    { name: "Agency", perDay: 600, devices: 5, price: "$4.99", period: "per month" },
  ],
};
