/* richtext.js — tiny rich-text editing with a strict sanitizer.
 * Colors/highlights use CSS classes (never style attributes) so the strict
 * CSP (style-src 'self') stays intact. Sanitizer whitelists tags/classes and
 * safe http(s) links only; CSP is the second layer against anything injected.
 */
(function (g) {
  "use strict";

  /* v4.7 — the allow-list is what a note can actually contain: anything not
   * here is unwrapped on save. It held eleven inline tags, so headings, lists,
   * quotes and code were impossible to keep even if you managed to create
   * them — the editor could produce them and the sanitizer would quietly eat
   * them on the way to the vault. Block structure is the difference between a
   * text box and a place you'd write something real, so the structural tags
   * are allowed now. Still a strict allow-list: no script, no style, no
   * iframe, no event attributes — only the tags a document is made of. */
  var TAGS = {
    B: 1, STRONG: 1, I: 1, EM: 1, U: 1, MARK: 1, BR: 1, DIV: 1, P: 1, SPAN: 1, A: 1,
    H1: 1, H2: 1, H3: 1,
    UL: 1, OL: 1, LI: 1,
    BLOCKQUOTE: 1, PRE: 1, CODE: 1, HR: 1,
    S: 1, STRIKE: 1, DEL: 1,
  };
  var CLASSES = { "txt-red": 1, "txt-blue": 1, "txt-green": 1, "txt-amber": 1, "txt-violet": 1 };

  function sanitize(html) {
    var tpl = document.createElement("template");
    tpl.innerHTML = html || "";
    clean(tpl.content);
    return tpl.innerHTML;
  }
  function clean(root) {
    var kids = Array.prototype.slice.call(root.childNodes);
    kids.forEach(function (n) {
      if (n.nodeType === Node.TEXT_NODE) return;
      if (n.nodeType !== Node.ELEMENT_NODE) { n.remove(); return; }
      if (!TAGS[n.tagName]) { // unwrap unknown tags, keep children
        clean(n);
        while (n.firstChild) root.insertBefore(n.firstChild, n);
        n.remove();
        return;
      }
      // strip attributes
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        var name = a.name.toLowerCase();
        if (n.tagName === "A" && name === "href") return;
        if (n.tagName === "SPAN" && name === "class" && CLASSES[a.value]) return;
        n.removeAttribute(a.name);
      });
      if (n.tagName === "A") {
        var href = n.getAttribute("href") || "";
        if (!/^https?:\/\//i.test(href)) {
          while (n.firstChild) root.insertBefore(n.firstChild, n);
          n.remove();
          return;
        }
        n.setAttribute("target", "_blank");
        n.setAttribute("rel", "noopener noreferrer");
      }
      clean(n);
    });
  }

  function textToHtml(text) {
    var d = document.createElement("div");
    d.textContent = text || "";
    return d.innerHTML.replace(/\n/g, "<br>");
  }

  function wrapSelection(area, tag, cls) {
    var sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    var r = sel.getRangeAt(0);
    if (!area.contains(r.commonAncestorContainer)) return;
    var w = document.createElement(tag);
    if (cls) w.className = cls;
    w.appendChild(r.extractContents());
    r.insertNode(w);
    sel.removeAllRanges();
    var nr = document.createRange();
    nr.selectNodeContents(w);
    sel.addRange(nr);
  }
  function exec(cmd, val) { try { document.execCommand(cmd, false, val || null); } catch (e) {} }

  /* v4.7 — markdown shortcuts while typing.
   *
   * This is the single thing that separates a text box from a writing tool:
   * you type "# " and it becomes a heading, "- " and it becomes a list. No
   * reaching for a toolbar, no breaking your sentence to click something.
   *
   * It fires on space only, at the very start of a line, and it is always
   * undoable in one Ctrl+Z because the marker is removed with the same
   * execCommand stack the browser is already tracking. If the pattern does
   * not match, nothing happens and the space is typed normally — a rule that
   * surprises you mid-sentence is worse than no rule. */
  var MD_RULES = [
    { re: /^###$/, run: function () { exec("formatBlock", "<h3>"); } },
    { re: /^##$/,  run: function () { exec("formatBlock", "<h2>"); } },
    { re: /^#$/,   run: function () { exec("formatBlock", "<h1>"); } },
    { re: /^[-*+]$/, run: function () { exec("insertUnorderedList"); } },
    { re: /^1\.$/,  run: function () { exec("insertOrderedList"); } },
    { re: /^>$/,   run: function () { exec("formatBlock", "<blockquote>"); } },
    { re: /^```$/, run: function () { exec("formatBlock", "<pre>"); } },
    { re: /^---$/, run: function () { exec("insertHorizontalRule"); } },
  ];

  function attachMarkdown(area) {
    area.addEventListener("keydown", function (e) {
      if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey) return;
      var sel = window.getSelection();
      if (!sel.rangeCount) return;
      var r = sel.getRangeAt(0);
      if (!r.collapsed || !area.contains(r.startContainer)) return;
      var node = r.startContainer;
      if (node.nodeType !== 3) return;                       // text nodes only
      var upto = node.data.slice(0, r.startOffset);
      // must be the whole line so far, or the marker isn't a marker
      if (/\S/.test(node.data.slice(0, r.startOffset).replace(upto, "")) ) return;
      var before = upto.trim();
      if (before !== upto.replace(/^\s+/, "")) return;
      for (var i = 0; i < MD_RULES.length; i++) {
        if (!MD_RULES[i].re.test(before)) continue;
        // only at the actual start of a block, not mid-paragraph
        var prev = node.previousSibling;
        if (prev && prev.nodeName !== "BR") return;
        e.preventDefault();
        // remove the marker with the browser's own undo stack, then format
        var del = document.createRange();
        del.setStart(node, r.startOffset - before.length);
        del.setEnd(node, r.startOffset);
        sel.removeAllRanges(); sel.addRange(del);
        exec("delete");
        MD_RULES[i].run();
        return;
      }
    });

    /* Escape from a block you did not mean to stay in: Enter on an empty
     * heading/quote/code line returns you to normal text, the way every
     * editor people already use behaves. */
    area.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.shiftKey) return;
      var sel = window.getSelection();
      if (!sel.rangeCount) return;
      var n = sel.getRangeAt(0).startContainer;
      var el2 = n.nodeType === 3 ? n.parentNode : n;
      while (el2 && el2 !== area && !/^(H1|H2|H3|BLOCKQUOTE|PRE)$/.test(el2.nodeName)) {
        el2 = el2.parentNode;
      }
      if (!el2 || el2 === area) return;
      if ((el2.textContent || "").trim() !== "") return;
      e.preventDefault();
      exec("formatBlock", "<p>");
    });
  }

  function el_sep() {
    var d = document.createElement("span");
    d.className = "rt-sep";
    return d;
  }

  /* Build a toolbar + contenteditable area. Returns {root, area,
     getHTML(), getText(), setHTML(html)} */
  function editor(initialHtml, t) {
    var root = document.createElement("div");
    root.className = "rt";
    var bar = document.createElement("div");
    bar.className = "rt-bar";
    var area = document.createElement("div");
    area.className = "rt-area";
    area.contentEditable = "true";
    area.innerHTML = sanitize(initialHtml || "");
    attachMarkdown(area);

    function btn(label, title, fn, cls) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "rt-btn " + (cls || "");
      if (label && label.nodeType) b.appendChild(label); else b.textContent = label;
      b.title = title;
      b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // keep selection
      b.addEventListener("click", fn);
      return b;
    }
    bar.appendChild(btn("B", t("rt_bold"), function () { exec("bold"); }, "rt-b"));
    bar.appendChild(btn("I", t("rt_italic"), function () { exec("italic"); }, "rt-i"));
    bar.appendChild(btn("U", t("rt_underline"), function () { exec("underline"); }, "rt-u"));
    bar.appendChild(btn("〰", t("rt_mark"), function () { wrapSelection(area, "mark"); }));

    /* v4.7 — block formats, reachable by click for anyone who doesn't know
     * the markdown shortcuts exist. Same commands the shortcuts run, so the
     * two routes can't produce different markup. */
    bar.appendChild(el_sep());
    bar.appendChild(btn("H", t("rt_h2"), function () { exec("formatBlock", "<h2>"); }, "rt-h"));
    bar.appendChild(btn("•", t("rt_ul"), function () { exec("insertUnorderedList"); }));
    bar.appendChild(btn("1.", t("rt_ol"), function () { exec("insertOrderedList"); }, "rt-ol"));
    bar.appendChild(btn("❝", t("rt_quote"), function () { exec("formatBlock", "<blockquote>"); }));
    bar.appendChild(btn("‹›", t("rt_code"), function () { exec("formatBlock", "<pre>"); }, "rt-code"));
    bar.appendChild(el_sep());
    [["txt-red", "●"], ["txt-green", "●"], ["txt-blue", "●"], ["txt-amber", "●"], ["txt-violet", "●"]]
      .forEach(function (c) {
        bar.appendChild(btn(c[1], t("rt_color"), function () {
          wrapSelection(area, "span", c[0]);
        }, "rt-dot " + c[0]));
      });
    var lsvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    lsvg.setAttribute("class", "ic ic-inline"); lsvg.setAttribute("viewBox", "0 0 24 24");
    var lu = document.createElementNS("http://www.w3.org/2000/svg", "use");
    lu.setAttribute("href", "#ic-link"); lsvg.appendChild(lu);
    bar.appendChild(btn(lsvg, t("rt_link"), function () {
      // Save the current selection before the dialog steals focus.
      var sel = window.getSelection();
      var saved = (sel.rangeCount && area.contains(sel.getRangeAt(0).commonAncestorContainer))
        ? sel.getRangeAt(0).cloneRange() : null;
      window.UI.prompt({ label: t("rt_linkAsk"), value: "https://", placeholder: "https://" })
        .then(function (url) {
          if (!url || !/^https?:\/\//i.test(url)) return;
          area.focus();
          if (saved) {
            var s2 = window.getSelection();
            s2.removeAllRanges();
            s2.addRange(saved);
          }
          exec("createLink", url);
        });
    }));
    bar.appendChild(btn("[[", t("rt_wl"), function () {
      var sel = window.getSelection();
      var saved = (sel.rangeCount && area.contains(sel.getRangeAt(0).commonAncestorContainer))
        ? sel.getRangeAt(0).cloneRange() : null;
      window.Links.pick(function (txt) {
        area.focus();
        if (saved) {
          var s2 = window.getSelection();
          s2.removeAllRanges();
          s2.addRange(saved);
        }
        exec("insertText", txt);
      });
    }, "rt-wl"));
    bar.appendChild(btn("⌫", t("rt_clear"), function () {
      var sel = window.getSelection();
      if (sel.rangeCount && !sel.isCollapsed) exec("insertText", sel.toString());
    }));

    root.appendChild(bar);
    root.appendChild(area);
    return {
      root: root,
      area: area,
      getHTML: function () { return sanitize(area.innerHTML); },
      getText: function () { return area.textContent || ""; },
      setHTML: function (h) { area.innerHTML = sanitize(h || ""); },
    };
  }

  // v1.16 (فاز F مورد ۳۶): plain text out of stored HTML, for Markdown export.
  // Sanitised first so nothing in the note can execute during conversion.
  function htmlToText(html) {
    var d = document.createElement("div");
    d.innerHTML = sanitize(html || "");
    d.querySelectorAll("br").forEach(function (n) { n.replaceWith("\n"); });
    d.querySelectorAll("p, div, li").forEach(function (n) { n.append("\n"); });
    return (d.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  }

  g.RT = { sanitize: sanitize, textToHtml: textToHtml, htmlToText: htmlToText, editor: editor };
})(window);
