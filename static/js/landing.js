/* landing.js — Aegis Planner public landing (v1.7.1).
 * 1) FA/EN toggle (persisted, flips document direction)
 * 2) Scroll-reveal via IntersectionObserver (staggered by CSS delays)
 * 3) Cursor-following background glow + 3D tilt on the hero preview
 * 4) Sticky topbar gains a blurred backdrop after scrolling
 * CSP-safe: external file only; animations set style properties, never HTML.
 */
(function () {
  "use strict";

  // ---- 1) language ---------------------------------------------------------
  var EN = {
    brand: "Aegis Planner",
    security: "Security",
    login: "Log in",
    enterApp: "Open the app",
    kicker: "Personal planner · encrypted",
    title: "A notebook only you can open.",
    sub: "Your tasks, notes and calendar are encrypted on your own device. We can't read them.",
    cta1: "Start with an invite code",
    buyH: "Get a subscription", buyPhone: "Phone", buyEmail: "Email (optional)", buySend: "Send request",
    cta2: "Get a subscription",
    trust1: "Only you can read it",
    trust2: "Jalali &amp; Gregorian",
    trust3: "No external services",
    trust4: "Build your own theme · Persian/English",
    n1: "1", n2: "2", n3: "3",
    showH: "See it work",
    showSub: "Write your bank password, work ideas or daily thoughts with a clear mind — not even we can see them. Here's how:",
    d1: "Tasks", d2: "Kanban", d3: "Habits", d4: "Focus", d5: "Your own theme",
    dt1: "Product design review",
    dt2: "Language practice — 30 min",
    dt3: "Call the sales team",
    dt4: "Weekly groceries",
    dtHigh: "Urgent", dtToday: "Today", dtWork: "Work", dtHome: "Home",
    dk1: "To do", dk2: "In progress", dk3: "Done",
    dh1: "Morning workout",
    dhN: "21",
    dfT: "25:00",
    df1: "The ring breathes with you",
    ver: "Version 4.0",
    tmInitial: "S",
    tmName: "Sepehr Khasto",
    tmRole: "Creator, designer and developer of Aegis Planner",
    tmBio: "I built Aegis because I wanted a tool that was both beautiful and genuinely mine: a place for my tasks, notes and days that nobody but me could read. I decided encryption would sit at the heart of the architecture from day one — not bolted on as a feature. This product is the result of hundreds of hours of obsessing over details you may never name, but will certainly feel.",
    tmP1: "Zero-knowledge architecture",
    tmP2: "Interface design",
    tmP3: "Django · JavaScript",
    tmMail: "Get in touch",
    tmSec: "Security model",
    tmTeamH: "Team",
    tmTeamS: "Aegis is a one-person product today. If you'd like to help build it — design, code, or just honest feedback — I'd love to hear from you.",
    pvTitle: "Calendar · Today",
    pvT1: "Deep work",
    pvT2: "Team sync",
    pvT3: "Workout",
    pvLock: "encrypted",
    s1: "on-device encryption",
    s2n: "0", s2: "data we can read",
    s3n: "2", s3: "calendars: Jalali & Gregorian",
    s4n: "5", s4: "calendar views, day to schedule",
    featH: "Stop juggling ten different apps",
    featSub: "Your Jalali calendar, daily to-dos and notes side by side — in one place, all yours alone.",
    f1t: "Encrypted on your device",
    f1b: "Everything you write is locked before it ever leaves your device. No one but you — not even us — can read it.",
    f2t: "A calendar that thinks like you",
    f2b: "Day/week/3-day/month views, Jalali or Gregorian — your choice. Drag, resize and move tasks like a pro calendar.",
    f3t: "From thought to done",
    f3b: "Tasks with categories, priority, subtasks and repeats. A Kanban board, natural-language quick add, and automatic exam & workout plans.",
    f4t: "Real progress, not illusion",
    f4b: "Habits with heatmaps, precise reports and weekly trends. Honest stats about what you actually did.",
    f5t: "Carry goals to the finish",
    f5b: "Month/year/long-term goals with milestones and a roadmap. Link tasks to goals and celebrate the moment you arrive.",
    f6t: "Full control, in your hands",
    f6b: "Export an encrypted backup, keep it anywhere, restore it anytime. Your data is yours — truly yours.",
    howH: "What does “zero-knowledge” mean?",
    howSub: "It means even if we wanted to, we couldn't read your data. Here's how:",
    h1t: "Your key is derived from your password",
    h1b: "Your master password becomes an encryption key inside your own browser — and it stays there.",
    h2t: "Data is locked before it's sent",
    h2b: "Every task and note is encrypted with AES-256-GCM on your device; the server only ever sees scrambled bytes.",
    h3t: "Only you can open it",
    h3b: "Unlock on any device with your master password. Forgot it? Reset it with the recovery key only you hold — without us ever seeing a word of your data. That's what real security means.",
    bandH: "Everything you'd forget, gathered in one place",
    m1: "Tasks", m2: "Calendar", m3: "Kanban", m4: "Habits", m5: "Goals",
    m7: "Notes", m9: "Focus", m10: "Reports",
    themesLb: "You build the theme — six colours, all yours:",
    tmore: "any colour",
    finalH: "Take your own space.",
    finalS: "Access is invite-only: a small, quiet, completely private circle.",
    buyS2: "One message on Telegram is all it takes — we sort out access and your invite code right there.",
    buyTgCta: "Message on Telegram",
    buyInvite: "Access is invite-only; after we've sorted things out your account goes live on admin approval.",
    finalCta: "Start now",
    how: "How is it secure?",
    home: "Home",   /* v3.2: was missing — the team page footer stayed Persian in EN mode */
    invite: "Access is invite-only, with admin approval",
    /* v3.2 — proof section */
    prH: "We don't just claim it. We show it.",
    prS: "The same data — once through your eyes, once through our server's.",
    prYou: "What you see",
    prSrv: "What our server sees",
    prR1: "Team sync — 10:00",
    prR2: "Weekly groceries",
    prR3: "Bank account password",
    prAes: "AES-256-GCM",
    prCap: "This is a demo, but the architecture is exactly this: plaintext never reaches the server — and what doesn't exist there can't leak from there.",
    /* v3.2 — comparison */
    cmpH: "Who can read your plans?",
    cmpS: "A fair comparison, naming no names.",
    cmpAspect: "Aspect",
    cmpCloud: "Typical cloud apps",
    cmpQ1: "Your tasks & notes on the server",
    cmpA1: "Encrypted on your device — the server only holds ciphertext",
    cmpB1: "Usually readable by the service",
    cmpQ2: "If the server is breached",
    cmpA2: "An attacker only sees scrambled bytes",
    cmpB2: "Raw data is exposed",
    cmpQ3: "Recovering a forgotten password",
    cmpA3: "With your own recovery key — we never see a thing",
    cmpB3: "Reset by the service, because it can access the data",
    /* v3.2 — FAQ */
    faqH: "The questions everyone asks",
    q1: "Where do I get an invite code?",
    a1: "Request one right on this page or message us on Telegram; once we've sorted things out you'll get an invite code, and your account goes live after admin approval. The circle stays small so the quality stays high.",
    q2: "What if I forget my master password?",
    a2: "You set a new one with the recovery key you saved when creating your account. Without it, no one — not even us — can bring the data back; that's the price of real security, so keep the recovery key somewhere safe.",
    q3: "What exactly is stored on the server?",
    a3: "Only the encrypted blob (ciphertext) plus account details like your username. The text of your tasks and notes never reaches the server in the clear.",
    q4: "Does it work offline?",
    a4: "Yes. It's a PWA: after your first online visit it installs on your phone or desktop, opens offline, and queues your changes to sync when you're back online.",
    q5: "Is there a Jalali calendar? And Persian?",
    a5: "Yes — both Jalali and Gregorian, with day / 3-day / week / month / schedule views. The whole interface is bilingual Persian/English and lays out correctly in both RTL and LTR.",
    q6: "Can I export my data?",
    a6: "Yes. Take an encrypted backup whenever you like, keep it anywhere, restore it anytime. The data is yours — no lock-in to us.",
  };

  var btn = document.getElementById("lang-toggle");
  var originals = {};
  document.querySelectorAll("[data-l]").forEach(function (n) {
    originals[n.getAttribute("data-l")] = n.innerHTML;
  });

  function apply(lang) {
    var en = lang === "en";
    document.querySelectorAll("[data-l]").forEach(function (n) {
      var k = n.getAttribute("data-l");
      if (en && EN[k] != null) n.innerHTML = EN[k];
      else if (!en && originals[k] != null) n.innerHTML = originals[k];
    });
    document.documentElement.setAttribute("lang", en ? "en" : "fa");
    document.documentElement.setAttribute("dir", en ? "ltr" : "rtl");
    document.body.setAttribute("dir", en ? "ltr" : "rtl");
    if (btn) btn.textContent = en ? "فا" : "EN";
    if (window.LangPref) window.LangPref.set(lang); else try { localStorage.setItem("sp_lang", lang); } catch (e) {}
  }

  if (btn) {
    btn.addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("lang") === "en" ? "en" : "fa";
      apply(cur === "en" ? "fa" : "en");
    });
  }
  var saved = null;
  saved = window.LangPref ? window.LangPref.get() : null;
  if (!saved) try { saved = localStorage.getItem("sp_lang"); } catch (e) {}
  if (saved === "en") apply("en");

  var reduced = false;
  try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // ---- 2) scroll reveal -----------------------------------------------------
  var toReveal = document.querySelectorAll(".lp-reveal");
  if (reduced || !("IntersectionObserver" in window)) {
    toReveal.forEach(function (n) { n.classList.add("lp-in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("lp-in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    toReveal.forEach(function (n) { io.observe(n); });
  }

  // ---- 3) cursor glow + hero preview tilt ------------------------------------
  var glow = document.getElementById("lp-glow");
  var preview = document.getElementById("lp-preview");
  var win = preview ? preview.querySelector(".lp-window") : null;
  var fine = false;
  try { fine = window.matchMedia("(pointer: fine)").matches; } catch (e) {}
  if (!reduced && fine) {
    var raf = null, mx = 0, my = 0;
    document.addEventListener("mousemove", function (e) {
      mx = e.clientX; my = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = null;
        if (glow) glow.style.transform = "translate(" + mx + "px," + my + "px)";
        if (win && preview) {
          var r = preview.getBoundingClientRect();
          if (mx >= r.left - 80 && mx <= r.right + 80 && my >= r.top - 80 && my <= r.bottom + 80) {
            var dx = (mx - (r.left + r.width / 2)) / r.width;   // -0.5 … 0.5
            var dy = (my - (r.top + r.height / 2)) / r.height;
            win.style.transform =
              "rotateY(" + (dx * 10).toFixed(2) + "deg) rotateX(" + (-dy * 8).toFixed(2) + "deg)";
          } else {
            win.style.transform = "";
          }
        }
      });
    });
  }

  // ---- 3b) spotlight that follows the cursor across the feature cards --------
  if (!reduced && fine) {
    document.querySelectorAll(".lp-card").forEach(function (card) {
      card.addEventListener("mousemove", function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty("--mx", (e.clientX - r.left) + "px");
        card.style.setProperty("--my", (e.clientY - r.top) + "px");
      });
    });
  }

  // ---- 3c) live showcase: tabs + a generated heatmap -------------------------
  (function showcase() {
    var tabs = document.querySelectorAll(".lp-show__tab");
    var demos = document.querySelectorAll(".lp-demo");
    if (!tabs.length) return;

    function select(name) {
      tabs.forEach(function (b) {
        var on = b.getAttribute("data-demo") === name;
        b.classList.toggle("active", on);
        /* v3.2: a tablist is only real if assistive tech can see the state —
         * aria-selected + roving tabindex, per the WAI-ARIA pattern. */
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.setAttribute("tabindex", on ? "0" : "-1");
      });
      demos.forEach(function (d) { d.classList.toggle("active", d.getAttribute("data-demo") === name); });
    }
    tabs.forEach(function (b) {
      b.addEventListener("click", function () {
        select(b.getAttribute("data-demo"));
        auto = false;   // the visitor took over; stop the carousel
      });
    });

    // v3.2: arrow keys walk the tabs (direction-aware, so RTL feels natural)
    var list = document.querySelector(".lp-show__tabs");
    if (list) {
      list.addEventListener("keydown", function (e) {
        var k = e.key;
        if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "Home" && k !== "End") return;
        var arr = Array.prototype.slice.call(tabs);
        var i = arr.indexOf(document.activeElement);
        if (i < 0) return;
        e.preventDefault();
        var rtl = (document.documentElement.getAttribute("dir") || "rtl") === "rtl";
        var next = k === "Home" ? 0
                 : k === "End" ? arr.length - 1
                 : (k === "ArrowRight") !== rtl ? (i + 1) % arr.length
                 : (i - 1 + arr.length) % arr.length;
        arr[next].focus();
        select(arr[next].getAttribute("data-demo"));
        auto = false;
      });
    }

    // build the habit heatmap (100 cells; a believable, streaky pattern)
    var map = document.querySelector(".lp-hb-map");
    if (map) {
      for (var i = 0; i < 100; i++) {
        var cell = document.createElement("i");
        // recent days are denser — it should look like someone building a streak
        var p = i < 40 ? 0.35 : i < 70 ? 0.6 : 0.92;
        if (Math.random() < p) {
          cell.classList.add("on");
          cell.style.animationDelay = (i * 22) + "ms";
        }
        map.appendChild(cell);
      }
    }

    // gently cycle through the tabs until the visitor clicks one
    var order = ["tasks", "kanban", "habits", "focus", "themes"];
    var idx = 0, auto = true;
    if (!reduced) {
      setInterval(function () {
        if (!auto) return;
        var wrap = document.querySelector(".lp-show__wrap");
        if (!wrap) return;
        var r = wrap.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return; // off-screen: idle
        idx = (idx + 1) % order.length;
        select(order[idx]);
      }, 6500);
    }
  })();

  // ---- 3d) proof section: ciphertext that never sits still -------------------
  // The point of the section is "the server sees noise". Static noise reads as
  // a screenshot; noise that keeps changing reads as a live wire. CSP-safe:
  // textContent only, no HTML. Runs only while on screen; a reduced-motion
  // visitor gets the same message from the static strings.
  (function cipher() {
    var host = document.getElementById("lp-cipher");
    if (!host) return;
    var rows = host.querySelectorAll(".lp-cipher");
    if (!rows.length || reduced || !("IntersectionObserver" in window)) return;
    var ABC = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789+/";
    function scramble(el) {
      var cur = el.textContent, out = "";
      for (var i = 0; i < cur.length; i++) {
        out += cur[i] === "…" ? "…" : ABC[(Math.random() * ABC.length) | 0];
      }
      el.textContent = out;
    }
    var timer = null;
    var io2 = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          if (!timer) timer = setInterval(function () {
            rows.forEach(scramble);
          }, 140);
        } else if (timer) { clearInterval(timer); timer = null; }
      });
    }, { threshold: 0.2 });
    io2.observe(host);
  })();

  // ---- 4) topbar blur on scroll ----------------------------------------------
  var top = document.getElementById("lp-top");
  if (top) {
    var onScroll = function () {
      top.classList.toggle("lp-top--scrolled", window.scrollY > 12);
    };
    document.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
})();
