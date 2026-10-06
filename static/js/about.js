(function () {
  var EN = {
    brand: "Secure Planner", login: "Log in", back: "Back to login",
    enterApp: "Open the app", backApp: "Back to the app",
    kicker: "Security model · Zero-knowledge",
    title: "How your data stays private",
    lead: "This planner is built on a zero-knowledge model: our server never sees the raw text of your data. All encryption and decryption happen in your own browser.",
    h1: "One master password, the key to everything",
    p1: "When you create your vault you choose a master password. Your browser derives a key from it through hundreds of thousands of math steps. That password and its key never leave your device — we can't see them, and neither can anyone else.",
    h2: "Encrypted with AES-256-GCM",
    p2: "Your vault content — notes, tasks, journal and the rest — is encrypted with AES-256-GCM before it leaves the browser. It's one of the strongest, most standard encryption algorithms, and it guarantees both confidentiality and tamper-detection.",
    h3: "The server is just a blind store",
    p3: "All the server keeps is ciphertext plus a wrapped key that is useless without your master password. Even if someone reached the database or the server itself — or the system admin — they'd see nothing but encrypted data.",
    h4: "Encrypted backups in your hands",
    p4: "You can export a backup of your vault any time. That file is fully encrypted too and only opens with your own master password, so you can keep it anywhere and re-import it later with confidence.",
    h5: "Other security layers",
    p5: "Registration is invite-only and requires admin approval; login is protected against guessing by account lockout and rate limiting; traffic is encrypted over HTTPS; and a strict Content-Security-Policy blocks unwanted script execution.",
    h6: "An honest note",
    p6: "This model's strength is also its responsibility: because the key is yours alone, if you forget your master password there is no way to recover your data. Pick a strong master password, store it somewhere safe, and back up your vault regularly. No system is '100% secure', but this model means your privacy doesn't depend on the server or its admin.",
  };
  var btn = document.getElementById("lang-toggle");
  var orig = {};
  document.querySelectorAll("[data-l]").forEach(function (n) { orig[n.getAttribute("data-l")] = n.innerHTML; });
  function apply(lang) {
    var en = lang === "en";
    document.querySelectorAll("[data-l]").forEach(function (n) {
      var k = n.getAttribute("data-l");
      n.innerHTML = en ? (EN[k] != null ? EN[k] : orig[k]) : orig[k];
    });
    document.documentElement.setAttribute("lang", en ? "en" : "fa");
    document.documentElement.setAttribute("dir", en ? "ltr" : "rtl");
    document.body.setAttribute("dir", en ? "ltr" : "rtl");
    if (btn) btn.textContent = en ? "فا" : "EN";
    if (window.LangPref) window.LangPref.set(lang); else try { localStorage.setItem("sp_lang", lang); } catch (e) {}
  }
  if (btn) btn.addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("lang") === "en" ? "en" : "fa";
    apply(cur === "en" ? "fa" : "en");
  });
  var saved = window.LangPref ? window.LangPref.get() : null;
  if (!saved) try { saved = localStorage.getItem("sp_lang"); } catch (e) {}
  if (saved === "en") apply("en");
})();
