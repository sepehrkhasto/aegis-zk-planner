/* links.js — bidirectional [[links]] between tasks, notes and goals (v1.13).
 *
 * Design notes:
 * - Links are *derived* from text, never stored as a second structure that
 *   could drift: any `[[Title]]` in a task's notes, a note's body or a goal's
 *   description is a link. Backlinks are computed by scanning the (already
 *   in-memory, decrypted) vault — cheap at personal-vault sizes.
 * - Resolution is by normalized title (Arabic ي/ك unified to Persian ی/ک,
 *   whitespace collapsed, case-folded). Renaming a target orphans old links;
 *   orphans render as a dashed "dead" chip instead of failing silently, and
 *   the FAQ says so. This is the Obsidian trade-off, chosen deliberately
 *   over id-links that would make the raw text unreadable.
 * - Everything is DOM-built (no innerHTML), so the strict CSP stays intact.
 */
(function (g) {
  "use strict";

  var RX = /\[\[([^\[\]\n]{1,120}?)\]\]/g;

  function norm(s) {
    return String(s || "")
      .replace(/\u064A/g, "\u06CC")   // ي → ی
      .replace(/\u0643/g, "\u06A9")   // ك → ک
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  /* v3.4.1 (فاز ۲): this read `g.Store`, but the store is exported as
   * `window.ZKStore` — `g.Store` was ALWAYS undefined, so vault() returned
   * {} and indexAll() returned an empty list. Consequence: the whole
   * [[link]] feature was dead — the picker offered nothing to link to,
   * backlinks were always empty, and every [[…]] rendered as unresolved. */
  function vault() {
    var S = g.ZKStore;
    return (S && S.vault) || {};
  }

  // Every linkable item, notes first (they're the most-linked kind).
  function indexAll() {
    var v = vault(), out = [];
    (v.notes || []).forEach(function (n) {
      out.push({ kind: "note", id: n.id, title: n.title || "", icon: "notes" });
    });
    (v.tasks || []).forEach(function (t) {
      if (!t.archived) out.push({ kind: "task", id: t.id, title: t.title || "", icon: "tasks" });
    });
    (v.goals || []).forEach(function (G) {
      out.push({ kind: "goal", id: G.id, title: G.title || "", icon: "goals" });
    });
    return out;
  }

  function resolve(title) {
    var n = norm(title);
    if (!n) return null;
    var all = indexAll();
    for (var i = 0; i < all.length; i++) {
      if (norm(all[i].title) === n) return all[i];
    }
    return null;
  }

  // ---- rendering ------------------------------------------------------------
  // Walk text nodes under `root`, turning [[Title]] into clickable chips.
  function decorate(root) {
    if (!root) return root;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest("a, .wl, .rt-area, textarea, input"))
          return NodeFilter.FILTER_REJECT;
        return n.nodeValue.indexOf("[[") >= 0
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(function (tn) {
      var text = tn.nodeValue;
      RX.lastIndex = 0;
      var m, last = 0, frag = document.createDocumentFragment(), any = false;
      while ((m = RX.exec(text))) {
        any = true;
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        frag.appendChild(chip(m[1]));
        last = m.index + m[0].length;
      }
      if (!any) return;
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      tn.parentNode.replaceChild(frag, tn);
    });
    return root;
  }

  function chip(title) {
    var hit = resolve(title);
    var T = g.I18N;
    if (!hit) {
      var dead = document.createElement("span");
      dead.className = "wl wl--dead";
      dead.textContent = title;
      dead.title = T.t("wl_dead");
      return dead;
    }
    var b = document.createElement("button");
    b.type = "button";
    b.className = "wl";
    b.textContent = hit.title;
    b.title = T.t("wl_open");
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      open(hit.kind, hit.id);
    });
    return b;
  }

  // ---- navigation -------------------------------------------------------------
  var ROUTES = { task: "#/tasks", note: "#/notes", goal: "#/goals" };
  function open(kind, id) {
    var route = ROUTES[kind];
    if (!route) return;
    if (location.hash !== route) location.hash = route;
    // let the router paint the page, then open the item's editor
    setTimeout(function () {
      var view = { task: g.TasksView, note: g.NotesView, goal: g.GoalsView }[kind];
      if (view && view.openById) view.openById(id);
    }, 140);
  }

  // ---- backlinks ---------------------------------------------------------------
  // "Which items mention [[this one]]?" — scan the three text fields.
  function backlinks(kind, id) {
    var v = vault();
    var me =
      kind === "note" ? (v.notes || []).find(function (x) { return x.id === id; }) :
      kind === "task" ? (v.tasks || []).find(function (x) { return x.id === id; }) :
                        (v.goals || []).find(function (x) { return x.id === id; });
    if (!me || !me.title) return [];
    var target = norm(me.title);
    var out = [];
    function scan(text, item, k) {
      if (!text || (k === kind && item.id === id)) return;
      RX.lastIndex = 0;
      var m;
      while ((m = RX.exec(text))) {
        if (norm(m[1]) === target) {
          out.push({ kind: k, id: item.id, title: item.title || "" });
          return;
        }
      }
    }
    (v.tasks || []).forEach(function (x) { scan(x.notes, x, "task"); });
    (v.notes || []).forEach(function (x) { scan(x.body, x, "note"); });
    (v.goals || []).forEach(function (x) { scan(x.desc, x, "goal"); });
    return out;
  }

  // A ready-made panel for editors: the backlinks list with clickable rows.
  // `beforeOpen` lets the host close its overlay before navigating.
  function backlinksPanel(kind, id, beforeOpen) {
    var T = g.I18N;
    var rows = backlinks(kind, id);
    if (!rows.length) return null;
    var box = document.createElement("div");
    box.className = "bl-panel";
    var h = document.createElement("p");
    h.className = "panel__text bl-panel__h";
    h.textContent = T.t("wl_backlinks") + " (" + rows.length + ")";
    box.appendChild(h);
    rows.forEach(function (r) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "bl-row";
      var k = document.createElement("span");
      k.className = "bl-row__kind";
      k.textContent = T.t("nav_" + (r.kind === "task" ? "tasks" : r.kind === "note" ? "notes" : "goals"));
      b.appendChild(k);
      b.appendChild(document.createTextNode(" " + (r.title || T.t("untitled"))));
      b.addEventListener("click", function () {
        if (beforeOpen) beforeOpen();
        open(r.kind, r.id);
      });
      box.appendChild(b);
    });
    return box;
  }

  // ---- insertion helpers ---------------------------------------------------
  // A small chooser: search everything, pick one, get "[[Title]]" back.
  function pick(onInsert) {
    var T = g.I18N;
    var ov = document.createElement("div");
    ov.className = "overlay";
    var card = document.createElement("div");
    card.className = "overlay__card wl-pick";
    var h = document.createElement("h2");
    h.className = "panel__title";
    h.textContent = T.t("wl_pickTitle");
    card.appendChild(h);
    var inp = document.createElement("input");
    inp.type = "search";
    inp.placeholder = T.t("wl_search");
    inp.setAttribute("dir", "auto");
    card.appendChild(inp);
    var list = document.createElement("div");
    list.className = "wl-pick__list";
    card.appendChild(list);
    function close() { ov.remove(); }
    function paint() {
      list.textContent = "";
      var q = norm(inp.value);
      indexAll()
        .filter(function (it) { return it.title && (!q || norm(it.title).indexOf(q) >= 0); })
        .slice(0, 12)
        .forEach(function (it) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "bl-row";
          var k = document.createElement("span");
          k.className = "bl-row__kind";
          k.textContent = T.t("nav_" + (it.kind === "task" ? "tasks" : it.kind === "note" ? "notes" : "goals"));
          b.appendChild(k);
          b.appendChild(document.createTextNode(" " + it.title));
          b.addEventListener("click", function () { close(); onInsert("[[" + it.title + "]]"); });
          list.appendChild(b);
        });
      if (!list.firstChild) {
        var e = document.createElement("p");
        e.className = "panel__text";
        e.textContent = T.t("wl_none");
        list.appendChild(e);
      }
    }
    inp.addEventListener("input", paint);
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
      if (e.key === "Enter") {
        var first = list.querySelector(".bl-row");
        if (first) first.click();
      }
    });
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    ov.appendChild(card);
    document.body.appendChild(ov);
    paint();
    inp.focus();
  }

  // Live "[[" autocomplete for plain textareas (task notes, goal description).
  function attachTextarea(ta) {
    var pop = null;
    var sel = 0;
    function closePop() { if (pop) { pop.remove(); pop = null; } }
    function ctx() {
      var upto = ta.value.slice(0, ta.selectionStart);
      var m = /\[\[([^\[\]\n]{0,60})$/.exec(upto);
      return m ? { q: m[1], start: upto.length - m[0].length } : null;
    }
    function complete(item, c) {
      var ins = "[[" + item.title + "]]";
      ta.value = ta.value.slice(0, c.start) + ins + ta.value.slice(ta.selectionStart);
      var pos = c.start + ins.length;
      ta.setSelectionRange(pos, pos);
      ta.focus();
      closePop();
    }
    function paint() {
      var c = ctx();
      if (!c) return closePop();
      var hits = indexAll().filter(function (it) {
        return it.title && norm(it.title).indexOf(norm(c.q)) >= 0;
      }).slice(0, 8);
      if (!hits.length) return closePop();
      if (!pop) {
        pop = document.createElement("div");
        pop.className = "wl-pop";
        document.body.appendChild(pop);
      }
      var r = ta.getBoundingClientRect();
      pop.style.setProperty("--x", Math.round(r.left) + "px");
      pop.style.setProperty("--y", Math.round(r.bottom + 4) + "px");
      pop.style.setProperty("--w", Math.round(r.width) + "px");
      pop.textContent = "";
      sel = Math.min(sel, hits.length - 1);
      hits.forEach(function (it, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "bl-row" + (i === sel ? " active" : "");
        b.textContent = it.title;
        b.addEventListener("mousedown", function (e) {
          e.preventDefault();
          complete(it, ctx() || c);
        });
        pop.appendChild(b);
      });
      pop._hits = hits;
      pop._ctx = c;
    }
    ta.addEventListener("input", function () { sel = 0; paint(); });
    ta.addEventListener("keydown", function (e) {
      if (!pop) return;
      var hits = pop._hits || [];
      if (e.key === "ArrowDown") { e.preventDefault(); sel = (sel + 1) % hits.length; paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = (sel - 1 + hits.length) % hits.length; paint(); }
      else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (hits[sel]) complete(hits[sel], pop._ctx);
      } else if (e.key === "Escape") closePop();
    });
    ta.addEventListener("blur", function () { setTimeout(closePop, 120); });
  }

  g.Links = {
    norm: norm,
    resolve: resolve,
    decorate: decorate,
    backlinks: backlinks,
    backlinksPanel: backlinksPanel,
    open: open,
    pick: pick,
    attachTextarea: attachTextarea,
  };
})(window);
