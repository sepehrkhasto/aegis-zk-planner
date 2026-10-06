/* whoami.js — v3.4.2
 *
 * Types the two terminal lines. The markup already CONTAINS the finished
 * text, so the page is complete and readable with JavaScript disabled or
 * still loading; this script only replays it as typing. CSP-safe: no inline
 * script, textContent only, never innerHTML.
 */
(function () {
  "use strict";

  var LINES = [
    { txt: "$ whoami", pause: 460 },
    { txt: "Sepehr", pause: 0, slow: true },
  ];

  function start() {
    var out = document.getElementById("tp-out");
    if (!out) return;

    var cur = document.createElement("span");
    cur.className = "tp__cur";

    var reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) { /* older browsers: just type */ }

    // Someone who asked for less motion gets the answer immediately — the
    // point of the page is the name, not the animation.
    if (reduced) {
      out.appendChild(cur);
      return;
    }

    out.textContent = "";
    var li = 0, ci = 0, timer = null;

    function step() {
      if (li >= LINES.length) { out.appendChild(cur); timer = null; return; }
      var line = LINES[li];
      if (ci === 0 && li > 0) out.appendChild(document.createTextNode("\n"));
      if (ci < line.txt.length) {
        out.appendChild(document.createTextNode(line.txt.charAt(ci)));
        ci++;
        // a little jitter so it reads as someone typing, not a machine printing
        timer = setTimeout(step, line.slow ? 130 : 58 + Math.random() * 48);
      } else {
        li++; ci = 0;
        timer = setTimeout(step, line.pause || 240);
      }
    }
    step();

    // if the tab is hidden mid-run, finish instantly rather than typing into
    // a screen nobody is watching and arriving half-done on return
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && timer) {
        clearTimeout(timer);
        timer = null;
        out.textContent = LINES.map(function (l) { return l.txt; }).join("\n");
        out.appendChild(cur);
        li = LINES.length;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
