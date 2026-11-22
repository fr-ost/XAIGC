// XAICG website settings: the one place for the site's addresses.
//
// The pages are built from this file. After changing anything here, run
//
//   node scripts/build-site.mjs
//
// and commit the result. (The addresses chromeStoreUrl, supportEmail and
// contactUrl are also read by the pages as they load, so a change to one of
// those shows up even before a rebuild.)
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

  // "Support" links lead to the help page on this site.
  supportUrl: "/support",
  // How people reach you from the contact and support pages. Put an email
  // address here and their button becomes "Email <address>"; leave it empty
  // to send people to contactUrl instead.
  supportEmail: "",
  contactUrl: "https://uniquelabs.org",
};
