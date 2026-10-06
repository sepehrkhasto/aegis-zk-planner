/* v4.9 — subscription page behaviour.
 *
 * Two small jobs, both external to the HTML because the app runs under a
 * strict CSP with no inline script allowed:
 *
 *   1. English. The page renders Persian; if the person has chosen English in
 *      the app, swap the labels and the numerals. Same contract as the panel:
 *      data-l for text, data-l-aria for screen-reader labels, plus data-fa /
 *      data-en on the numbers so digits switch script too.
 *   2. Carry the chosen plan into Telegram, so the first message already says
 *      what they picked instead of making them retype it.
 *
 * Plan SELECTION itself is pure CSS (radio + label). No JS is required to see
 * which plan is active — if this file never loads, the page still works.
 */
(function () {
  "use strict";

  var EN = {
    back: "Back",
    backToApp: "Back to the app",
    hTitle: "Aegis subscription",
    lede: "One complete product, no cut-down edition. You only choose how long.",
    stExpiredT: "Your subscription has ended",
    stExpiredS: "All your data is intact and readable, and you can still export it. Editing returns when you renew.",
    stActiveT: "Your subscription is active",
    stActiveUntil: "Valid until",
    plansLabel: "Subscription length",
    saveWord: "Save",
    monthWord: "months",
    toman: "Toman",
    perMonth: "That's per month",
    pick: "Choose",
    picked: "Chosen",
    hPay: "How to pay",
    mGateway: "Card payment",
    mGatewayS: "Pay directly by bank card. Not available yet.",
    mGatewayBtn: "Coming soon",
    soon: "Coming soon",
    active: "Available",
    mTelegram: "Buy via Telegram",
    mTelegramS: "Message",
    mTelegramBtn: "Continue on Telegram",
    noteT: "Paying is separate from your data.",
    noteS: "We only extend the subscription date on your account. Your key and the contents of your encrypted vault never reach the server \u2014 not before payment, not after."
  };

  function lang() {
    try { return localStorage.getItem("sp_lang") || "fa"; }
    catch (e) { return "fa"; }
  }

  function applyEnglish() {
    document.querySelectorAll("[data-l]").forEach(function (n) {
      var v = EN[n.getAttribute("data-l")];
      if (v !== undefined) n.textContent = v;
    });
    document.querySelectorAll("[data-l-aria]").forEach(function (n) {
      var v = EN[n.getAttribute("data-l-aria")];
      if (v !== undefined) n.setAttribute("aria-label", v);
    });
    // numerals: Persian digits are baked into the HTML, so swap them too
    document.querySelectorAll(".js-fa").forEach(function (n) {
      var v = n.getAttribute("data-en");
      if (v !== null) n.textContent = v;
    });
    document.documentElement.setAttribute("lang", "en");
    document.documentElement.setAttribute("dir", "ltr");
  }

  function wireTelegram() {
    var go = document.getElementById("tg-go");
    if (!go) return;
    var base = go.getAttribute("data-base") || go.href;
    var en = lang() === "en";

    function sync() {
      var sel = document.querySelector('input[name="plan"]:checked');
      if (!sel) { go.href = base; return; }
      var label = sel.getAttribute(en ? "data-label-en" : "data-label-fa") || "";
      var msg = en
        ? "Hi! I'd like the " + label + " Aegis Planner subscription."
        : "سلام! می‌خواهم اشتراک " + label + " ایجیس پلنر را بخرم.";
      go.href = base + "?text=" + encodeURIComponent(msg);
    }

    document.querySelectorAll('input[name="plan"]').forEach(function (r) {
      r.addEventListener("change", sync);
    });
    sync();

    // v5.0 — tell the server which plan was reached for, then get out of the
    // way. sendBeacon is used precisely because it does NOT delay the click:
    // the browser posts it in the background while navigation to Telegram
    // continues. A metric must never stand between someone and a purchase, so
    // there is no await here and no error path that could block the link.
    go.addEventListener("click", function () {
      var sel = document.querySelector('input[name="plan"]:checked');
      if (!sel || !navigator.sendBeacon) return;
      try {
        var fd = new FormData();
        fd.append("plan", sel.value);
        fd.append("csrfmiddlewaretoken", csrfToken());
        navigator.sendBeacon("/accounts/purchase-intent/", fd);
      } catch (e) { /* never block the purchase */ }
    });
  }

  function csrfToken() {
    var m = document.querySelector('meta[name="csrf-token"]');
    if (m) return m.content;
    var i = document.querySelector('input[name="csrfmiddlewaretoken"]');
    return i ? i.value : "";
  }

  function init() {
    if (lang() === "en") applyEnglish();
    wireTelegram();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
