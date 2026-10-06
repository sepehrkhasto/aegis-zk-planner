/* auth_i18n.js — bilingual login / register / pending pages.
 *
 * These pages are server-rendered by Django in Persian. The SPA already has a
 * language switch, but a brand-new user never reaches it — they hit the login
 * screen first. So the same preference (sp_lang) is honoured here, and a small
 * FA/EN toggle is injected so the choice can be made before signing in.
 * CSP-safe: external file, no inline script, no innerHTML.
 */
(function () {
  "use strict";

  var EN = {
    // login
    loginTitle: "Welcome",
    loginSub: "Sign in with your username and password.",
    loginBtn: "Log in",
    loginPinHint: "Quick unlock with a PIN or passkey turns on inside the app after your first sign-in.",
    noAccount: "No account yet?",
    registerLink: "Sign up with an invite code",
    // register
    regTitle: "Sign up",
    regSub: "You need an invite code to sign up. Your account becomes active after admin approval.",
    regBtn: "Create account",
    haveAccount: "Already registered?",
    loginLink: "Log in",
    // pending
    pendTitle: "Awaiting approval",
    pendSub: "Your account was created and is waiting for admin approval. You'll be able to log in once it's activated.",
    backToLogin: "Back to the login page",
    // shared
    home: "Home",
    howSecure: "How is this planner secure?",
    // 403 / 404 / 500 pages (v3.2.3 — errors speak both languages too)
    e403Code: "403",
    e403Title: "Access denied",
    e403Sub: "You don't have permission to view this page.",
    e404Code: "404",
    e404Title: "Page not found",
    e404Sub: "The page you were looking for doesn't exist.",
    e500Code: "500",
    e500Title: "Server error",
    e500Sub: "Something went wrong on our side. Please try again shortly.",
    backHome: "Back to home",
    // 429 page (v1.13.1)
    e429Code: "429",
    e429Title: "Take a short break",
    e429Sub: "Too many attempts came from this device or network, so a short security pause kicked in. Try again in a minute or two — your account and data are untouched.",
    // offline fallback page (v1.13.3)
    offTitle: "No internet connection",
    offSub: "This page isn't stored for offline use yet. Your planner opens offline after its first online visit.",
    offOpen: "Open the planner",
    // Django form labels, keyed by field name
    fld_username: "Username",
    fld_password: "Password",
    fld_password1: "Password",
    fld_password2: "Repeat password",
    fld_invite_code: "Invite code",
  };

  var root = document.documentElement;

  function lang() {
    try { return localStorage.getItem("sp_lang") === "en" ? "en" : "fa"; }
    catch (e) { return "fa"; }
  }

  var originals = null;
  function snapshot() {
    if (originals) return;
    originals = [];
    document.querySelectorAll("[data-l]").forEach(function (n) {
      originals.push([n, n.textContent]);
    });
  }

  function apply(l) {
    snapshot();
    var en = l === "en";
    document.querySelectorAll("[data-l]").forEach(function (n) {
      var k = n.getAttribute("data-l");
      if (en && EN[k] != null) { n.textContent = EN[k]; return; }
      if (!en) {
        for (var i = 0; i < originals.length; i++) {
          if (originals[i][0] === n) { n.textContent = originals[i][1]; return; }
        }
      }
    });
    // Django form labels carry the field name so they can be swapped too
    document.querySelectorAll("label[for]").forEach(function (lb) {
      var input = document.getElementById(lb.getAttribute("for"));
      if (!input || !input.name) return;
      var k = "fld_" + input.name;
      if (en && EN[k] != null) {
        if (!lb.hasAttribute("data-fa")) lb.setAttribute("data-fa", lb.textContent);
        lb.textContent = EN[k];
      } else if (!en && lb.hasAttribute("data-fa")) {
        lb.textContent = lb.getAttribute("data-fa");
      }
    });
    root.setAttribute("lang", en ? "en" : "fa");
    root.setAttribute("dir", en ? "ltr" : "rtl");
    var btn = document.getElementById("auth-lang");
    if (btn) btn.textContent = en ? "فارسی" : "English";
  }

  function mount() {
    var card = document.querySelector(".auth-card");
    if (card) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.id = "auth-lang";
      btn.className = "btn btn--ghost btn--sm auth-lang";
      btn.addEventListener("click", function () {
        var next = lang() === "en" ? "fa" : "en";
        try { localStorage.setItem("sp_lang", next); } catch (e) {}
        apply(next);
      });
      card.insertBefore(btn, card.firstChild);
    }
    apply(lang());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
