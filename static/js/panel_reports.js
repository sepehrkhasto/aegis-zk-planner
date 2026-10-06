/* v5.0 — report bar widths.
 *
 * The bars are proportional to the largest route, so the width can only be
 * known once the numbers are on the page. It is set here rather than as an
 * inline style attribute because the app runs under a strict CSP that forbids
 * inline style — and the project's own CSP test enforces it.
 *
 * Setting .style from an external script is allowed (it is not an inline
 * attribute), so this stays within the policy.
 */
(function () {
  "use strict";
  function draw() {
    var fills = document.querySelectorAll(".rp-bar__fill[data-pct]");
    if (!fills.length) return;
    var max = 0;
    fills.forEach(function (f) {
      max = Math.max(max, parseInt(f.getAttribute("data-pct"), 10) || 0);
    });
    fills.forEach(function (f) {
      var v = parseInt(f.getAttribute("data-pct"), 10) || 0;
      // a zero stays visibly zero; anything else gets at least a sliver so the
      // bar reads as "small", not "missing"
      f.style.width = max ? (v ? Math.max(3, (v / max) * 100) : 0) + "%" : "0%";
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", draw);
  } else { draw(); }
})();
