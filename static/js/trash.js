/* trash.js — recycle bin. Items live 30 days, restorable to their source. */
(function (g) {
  "use strict";
  var ctx = null;
  /* v3.5 (فاز ۴): the journal merged into notes. Anything trashed BEFORE the
   * merge still says kind:"journal", so it restores into notes — otherwise it
   * would come back into an array nothing reads any more, i.e. vanish. */
  var KIND_KEY = { task: "tasks", note: "notes", journal: "notes", list: "notes", goal: "goals" };

  function init(c) { ctx = c; }
  function t(k) { return ctx.T.t(k); }
  function el(a, b, c) { return ctx.el(a, b, c); }

  function label(item) {
    var x = item.item || {};
    return x.title || x.name || (x.body ? x.body.slice(0, 40) : "") || "—";
  }
  function kindName(k) { return t("tr_" + k); }
  function faDate(iso) {
    var d = new Date(iso);
    var j = ctx.J.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return window.CalSys.label(j);
  }

  // v1.16 (فاز F مورد ۳۲): multi-select with select-all / restore-all /
  // delete-all. Restoring many items reuses the same single-item logic, so a
  // batch can never diverge from what one restore does.
  var picked = null;   // Set of trash entries chosen in this render

  function restoreOne(it) {
    var key = KIND_KEY[it.kind];
    if (key) {
      if (!ctx.S.vault[key]) ctx.S.vault[key] = [];
      var item = it.item;
      // a pre-merge journal entry becomes a note the same way the vault
      // migration converts them, so it looks identical to the rest
      if (it.kind === "journal" && item && !item.jdate) {
        item.folder = item.folder || "ژورنال";
        item.jdate = item.date || null;
        if (item.mood === undefined) item.mood = null;
      }
      /* v3.6: a list trashed before the merge restores as a checklist note */
      if (it.kind === "list" && item && item.items) {
        item.title = item.title || item.name || "";
        item.body = (item.items || []).map(function (x) {
          return (x.done ? "\u2611 " : "\u2610 ") + String(x.text || "");
        }).join("\n");
        item.folder = item.folder || "چک‌لیست";
        delete item.items;
      }
      ctx.S.vault[key].push(item);
    }
  }
  function drop(list) {
    ctx.S.vault.trash = (ctx.S.vault.trash || []).filter(function (x) {
      return list.indexOf(x) < 0;
    });
  }

  function render(host) {
    ctx.S.trashPurge();
    var items = (ctx.S.vault.trash || []).slice().reverse();
    picked = [];

    host.appendChild(el("p", "panel__text", t("tr_hint")));

    if (!items.length) {
      host.appendChild(el("p", "panel__text", t("tr_empty")));
      return;
    }

    var bar = el("div", "selbar");
    var count = el("span", "selbar__count", ctx.num(0) + " " + t("sel_selected"));
    function sync() {
      count.textContent = ctx.num(picked.length) + " " + t("sel_selected");
      reSel.disabled = puSel.disabled = !picked.length;
    }
    var all = el("button", "btn btn--ghost btn--sm", t("sel_all"));
    all.addEventListener("click", function () {
      var on = picked.length < items.length;
      picked = on ? items.slice() : [];
      host.querySelectorAll(".tr-check").forEach(function (c) { c.checked = on; });
      sync();
    });
    var reSel = el("button", "btn btn--ghost btn--sm", t("tr_restoreSel"));
    reSel.addEventListener("click", async function () {
      var list = picked.slice();
      list.forEach(restoreOne); drop(list);
      ctx.status("tr_restored", "success"); ctx.rerender(); ctx.persistBg();
    });
    var puSel = el("button", "btn btn--ghost btn--sm btn--danger", t("tr_purgeSel"));
    puSel.addEventListener("click", async function () {
      if (!(await ctx.UI.confirm({ body: t("tr_confirmPurgeSel"), danger: true }))) return;
      drop(picked.slice());
      ctx.status("msg_deleted", "success"); ctx.rerender(); ctx.persistBg();
    });
    var empty = el("button", "btn btn--ghost btn--sm btn--danger", t("tr_emptyAll"));
    empty.addEventListener("click", async function () {
      if (!(await ctx.UI.confirm({ body: t("tr_confirmEmpty"), danger: true }))) return;
      ctx.S.vault.trash = [];
      ctx.status("msg_deleted", "success"); ctx.rerender(); ctx.persistBg();
    });
    bar.appendChild(all); bar.appendChild(count);
    bar.appendChild(reSel); bar.appendChild(puSel); bar.appendChild(empty);
    host.appendChild(bar);
    sync();

    var wrap = el("div", "panel");
    items.forEach(function (it) {
      var row = el("div", "tr-row");
      var c = el("input"); c.type = "checkbox"; c.className = "task-check tr-check";
      c.addEventListener("change", function () {
        if (c.checked) { if (picked.indexOf(it) < 0) picked.push(it); }
        else picked = picked.filter(function (x) { return x !== it; });
        sync();
      });
      row.appendChild(c);
      row.appendChild(el("span", "badge", kindName(it.kind)));
      row.appendChild(el("span", "tr-row__title", label(it)));
      row.appendChild(el("span", "tr-row__date", faDate(it.at)));

      var act = el("div", "task-actions");
      var re = el("button", "btn btn--ghost btn--sm", t("tr_restore"));
      re.addEventListener("click", async function () {
        restoreOne(it); drop([it]);
        ctx.status("tr_restored", "success"); ctx.rerender(); ctx.persistBg();
      });
      var pu = el("button", "btn btn--ghost btn--sm btn--danger", t("tr_purge"));
      pu.addEventListener("click", async function () {
        if (!(await ctx.UI.confirm({ body: t("tr_confirmPurge"), danger: true }))) return;
        drop([it]);
        ctx.status("msg_deleted", "success"); ctx.rerender(); ctx.persistBg();
      });
      act.appendChild(re); act.appendChild(pu);
      row.appendChild(act);
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
  }

  g.TrashView = { init: init, render: render };
})(window);
