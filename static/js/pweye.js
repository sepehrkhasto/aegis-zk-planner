/* pweye.js — adds a show/hide "eye" toggle to every password input that has a
 * data-eye attribute. CSP-safe (external file), no dependencies. Re-runnable:
 * call window.PwEye.scan(root) after injecting new inputs dynamically.
 */
(function (g) {
  "use strict";

  function wrap(input) {
    if (input.__eye) return;
    input.__eye = true;

    var holder = document.createElement("div");
    holder.className = "pw-wrap";
    /* v3.4 (فاز ۱) — the second half of the "eye sits on the password" bug.
     * Every master-password field carries dir="ltr" (a password should read
     * left-to-right) while the page itself is dir="rtl". The eye is placed
     * with `inset-inline-end` on this wrapper → resolved against RTL → LEFT.
     * The reserved space is `padding-inline-end` on the input → resolved
     * against its own LTR → RIGHT. Opposite sides: the text ran straight
     * under the button. Copying the input's direction onto the wrapper makes
     * both logical properties resolve to the SAME physical edge. */
    var idir = input.getAttribute("dir");
    if (idir) holder.setAttribute("dir", idir);
    var parent = input.parentNode;
    parent.insertBefore(holder, input);
    holder.appendChild(input);
    input.classList.add("pw-has-eye");

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-eye";
    btn.setAttribute("aria-label", "show/hide password");
    btn.tabIndex = -1;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
    btn.addEventListener("click", function () {
      var showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.classList.toggle("on", !showing);
      btn.setAttribute("aria-pressed", String(!showing));
      input.focus();
    });
    holder.appendChild(btn);
  }

  function scan(root) {
    (root || document).querySelectorAll("input[data-eye]").forEach(wrap);
  }

  g.PwEye = { scan: scan, wrap: wrap };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { scan(document); });
  } else {
    scan(document);
  }
})(window);
