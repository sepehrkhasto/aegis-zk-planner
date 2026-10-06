/* fx.js — the motion & delight layer (v1.8).
 *
 * One small, dependency-free engine every module can call:
 *   FX.reduced()                  -> respects prefers-reduced-motion
 *   FX.haptic("tick"|"warn"|"heavy")
 *   FX.confetti(anchorEl)         -> a short, tasteful burst (canvas-free)
 *   FX.countUp(el, to, opts)      -> numbers roll to their value
 *   FX.stagger(nodes, step)       -> children rise in sequence
 *   FX.settle(el)                 -> springy "lands in place" for dropped blocks
 *   FX.empty(kind, title, sub, action) -> illustrated empty state
 *
 * Every animation is off when the OS asks for reduced motion, and nothing here
 * ever injects HTML strings — CSP stays strict.
 */
(function (g) {
  "use strict";

  function reduced() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  // ---- haptics -------------------------------------------------------------
  var PATTERNS = { tick: 12, warn: [8, 40, 8], heavy: 24, soft: 6 };
  function haptic(kind) {
    if (reduced()) return;
    if (!navigator.vibrate) return;
    try { navigator.vibrate(PATTERNS[kind] || PATTERNS.tick); } catch (e) {}
  }

  // ---- confetti ------------------------------------------------------------
  // DOM-based (a dozen nodes, removed on animation end) so it inherits theme
  // colors and needs no canvas or library.
  var CONFETTI_VARS = ["--accent", "--accent-2", "--ok", "--warn", "--danger"];
  function confetti(anchor, count) {
    if (reduced()) return;
    var n = count || 26;
    var host = el("div", "fx-confetti");
    var rect = anchor && anchor.getBoundingClientRect
      ? anchor.getBoundingClientRect() : null;
    var cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    var cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 3;
    host.style.left = cx + "px";
    host.style.top = cy + "px";
    for (var i = 0; i < n; i++) {
      var p = el("i", "fx-confetti__p");
      var ang = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.5;
      var dist = 70 + Math.random() * 110;
      p.style.setProperty("--dx", (Math.cos(ang) * dist).toFixed(1) + "px");
      p.style.setProperty("--dy", (Math.sin(ang) * dist - 30).toFixed(1) + "px");
      p.style.setProperty("--rot", (Math.random() * 720 - 360).toFixed(0) + "deg");
      p.style.setProperty("--delay", (Math.random() * 90).toFixed(0) + "ms");
      p.style.background = "var(" + CONFETTI_VARS[i % CONFETTI_VARS.length] + ")";
      if (i % 3 === 0) p.classList.add("fx-confetti__p--round");
      host.appendChild(p);
    }
    document.body.appendChild(host);
    setTimeout(function () { host.remove(); }, 1400);
  }

  // ---- number count-up ------------------------------------------------------
  function countUp(node, to, opts) {
    opts = opts || {};
    var fmt = opts.format || function (v) { return String(v); };
    if (reduced()) { node.textContent = fmt(to); return; }
    var from = opts.from || 0;
    var dur = opts.duration || 700;
    var t0 = null;
    function ease(p) { return 1 - Math.pow(1 - p, 3); } // easeOutCubic
    function step(ts) {
      if (t0 == null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      node.textContent = fmt(Math.round(from + (to - from) * ease(p)));
      if (p < 1) requestAnimationFrame(step);
    }
    node.textContent = fmt(from);
    requestAnimationFrame(step);
  }

  // ---- staggered entrance ----------------------------------------------------
  function stagger(nodes, stepMs) {
    if (reduced() || !nodes) return;
    var step = stepMs || 45;
    Array.prototype.slice.call(nodes).forEach(function (n, i) {
      n.classList.add("fx-rise");
      n.style.animationDelay = (i * step) + "ms";
      n.addEventListener("animationend", function () {
        n.classList.remove("fx-rise");
        n.style.animationDelay = "";
      }, { once: true });
    });
  }

  // ---- springy settle (after a drag/drop) ------------------------------------
  function settle(node) {
    if (reduced() || !node) return;
    node.classList.remove("fx-settle");
    void node.offsetWidth; // restart the animation
    node.classList.add("fx-settle");
    node.addEventListener("animationend", function () {
      node.classList.remove("fx-settle");
    }, { once: true });
  }

  // ---- illustrated empty states ----------------------------------------------
  // Hand-drawn one-off SVGs (sprite ids live in app.html: #il-<kind>).
  function empty(kind, title, sub, action) {
    var wrap = el("div", "fx-empty");
    var art = el("div", "fx-empty__art");
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 120 100");
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#il-" + kind);
    svg.appendChild(use);
    art.appendChild(svg);
    wrap.appendChild(art);
    wrap.appendChild(el("h3", "fx-empty__t", title));
    if (sub) wrap.appendChild(el("p", "fx-empty__s", sub));
    if (action && action.label && action.onClick) {
      var b = el("button", "btn btn--primary btn--sm fx-empty__btn", action.label);
      b.addEventListener("click", action.onClick);
      wrap.appendChild(b);
    }
    return wrap;
  }

  // ---- drag-to-dismiss sheets (v1.8.3) --------------------------------------
  // On a phone, a sheet you cannot drag is just a modal wearing a costume.
  // Apple's rules, applied literally: respond on pointer-down; move with the
  // finger (never a scripted animation); resist with damping when dragged the
  // wrong way; and on release, project the user's own velocity forward — a
  // quick flick dismisses even if the distance is short.
  function draggableSheet(card, onClose) {
    if (!window.matchMedia("(max-width: 700px)").matches) return;
    if (reduced()) return;

    var y = 0, startY = 0, t0 = 0, dragging = false, pid = null;
    var h = card.getBoundingClientRect().height || 400;

    function scrolledToTop() {
      // only start a sheet drag when the content itself is at the top,
      // otherwise the user is trying to scroll and we must not steal it
      return card.scrollTop <= 0;
    }
    function paint() {
      card.style.transition = "none";
      card.style.transform = "translateY(" + y.toFixed(1) + "px)";
      var ov = card.parentElement;
      if (ov) ov.style.opacity = String(Math.max(0.25, 1 - (y / h) * 0.9));
    }
    function release(velocity) {
      card.style.transition = "";  // hand back to CSS (interruptible)
      var ov = card.parentElement;
      // a flick counts: velocity threshold, exactly like a Sonner dismiss
      if (y > h * 0.32 || velocity > 0.55) {
        card.style.transform = "translateY(100%)";
        if (ov) ov.style.opacity = "0";
        setTimeout(function () { if (onClose) onClose(); }, 180);
      } else {
        card.style.transform = "";
        if (ov) ov.style.opacity = "";
      }
    }

    card.addEventListener("pointerdown", function (e) {
      if (dragging) return;                                  // multi-touch guard
      if (e.target.closest("input, textarea, select, button, .rt-area")) return;
      if (!scrolledToTop()) return;
      pid = e.pointerId; startY = e.clientY; t0 = Date.now();
      dragging = true; y = 0;
      h = card.getBoundingClientRect().height || h;
    });
    card.addEventListener("pointermove", function (e) {
      if (!dragging || e.pointerId !== pid) return;
      var dy = e.clientY - startY;
      // pulling the sheet UP past its home position is damped, not blocked —
      // things in the real world slow down before they stop
      y = dy < 0 ? dy * 0.18 : dy;
      if (Math.abs(dy) > 4) {
        try { card.setPointerCapture(pid); } catch (err) {}
        e.preventDefault();
        paint();
      }
    }, { passive: false });
    function end(e) {
      if (!dragging || (pid != null && e.pointerId !== pid)) return;
      dragging = false;
      var dt = Math.max(1, Date.now() - t0);
      release(Math.max(0, y) / dt);
    }
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", function () {
      if (!dragging) return;
      dragging = false;
      release(0);
    });
  }

  g.FX = {
    draggableSheet: draggableSheet,
    reduced: reduced,
    haptic: haptic,
    confetti: confetti,
    countUp: countUp,
    stagger: stagger,
    settle: settle,
    empty: empty,
  };
})(window);
