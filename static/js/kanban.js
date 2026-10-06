/* kanban.js — Trello-style board over the same tasks. A task's column comes
 * from x.status ("todo" | "doing" | "done"); if unset we derive it from x.done.
 * Moving a card to "done" sets done=true; moving out clears it. Drag works on
 * mouse and touch via Pointer Events.
 */
(function (g) {
  "use strict";
  var ctx = null;
  var COLS = ["todo", "doing", "done"];

  function init(c) { ctx = c; }
  var pageState = {};   // per-column "show more" depth (B7 pagination)
  function t(k) { return ctx.T.t(k); }
  function el(a, b, c) { return ctx.el(a, b, c); }
  function tasks() {
    if (!ctx.S.vault.tasks) ctx.S.vault.tasks = [];
    return ctx.S.vault.tasks;
  }
  function statusOf(x) {
    if (x.status && COLS.indexOf(x.status) >= 0) return x.status;
    return x.done ? "done" : "todo";
  }
  function setStatus(x, status) {
    x.status = status;
    if (status === "done") {
      if (!x.done) { x.done = true; x.doneAt = new Date().toISOString(); }
    } else {
      if (x.done) { x.done = false; x.doneAt = null; }
    }
  }
  function dueLabel(x) {
    // display calendar (Jalali or Gregorian) — the raw vault date is Jalali,
    // so in English mode this used to print Persian month names + digits
    var CS = window.CalSys;
    var d = CS.jToDisp(x.due);
    return ctx.num(d.d) + " " + CS.monthName(d.m);
  }


  /* v5.6 — moving a card is a DOM move, not a board rebuild.
   *
   * Dropping a card used to call ctx.rerender(), which wipes the route and
   * reconstructs every column, every card and every drag handler on the board.
   * With three columns of thirty cards that is ninety elements rebuilt to move
   * one — and it ran on every single drag, which is what made the board feel
   * heavy.
   *
   * A card's appearance carries nothing from its column (card() renders title,
   * priority, category and due date — none of which depend on status), so the
   * move is exactly: relocate one node, fix the two counts, and fix the two
   * empty-states. The node keeps its own listeners because it is moved, not
   * recreated.
   *
   * Returns false if the DOM is not in the shape we expect, so the caller can
   * fall back to a full render rather than leave the board half-updated. */
  function moveCardDom(cardEl, toCol) {
    if (!cardEl || !cardEl.parentNode) return false;
    var fromBody = cardEl.closest(".kb-col__body");
    var board = cardEl.closest(".kb-board");
    if (!fromBody || !board) return false;
    var toBody = board.querySelector('.kb-col__body[data-col="' + toCol + '"]');
    if (!toBody) return false;

    // a paginated column ends with a "show more" button; the card belongs
    // above it, not after it
    var more = toBody.querySelector(".kb-more");
    var placeholder = toBody.querySelector(".kb-empty");
    if (placeholder) toBody.removeChild(placeholder);
    if (more) toBody.insertBefore(cardEl, more);
    else toBody.appendChild(cardEl);

    // the source column may now be empty
    if (!fromBody.querySelector(".kb-card") && !fromBody.querySelector(".kb-empty")) {
      fromBody.appendChild(el("div", "kb-empty", t("kb_empty")));
    }
    refreshCount(fromBody);
    refreshCount(toBody);
    return true;
  }

  function refreshCount(body) {
    var column = body.closest(".kb-col");
    if (!column) return;
    var n = body.querySelectorAll(".kb-card").length;
    var col = body.getAttribute("data-col");
    // the visible count must reflect the whole column, not just the rendered
    // page, or a paginated column would appear to shrink when a card leaves
    var total = tasks().filter(function (x) {
      return !x.archived && statusOf(x) === col;
    }).length;
    var badge = column.querySelector(".kb-col__count");
    if (badge) badge.textContent = ctx.num(total);
    return n;
  }

  function card(x) {
    var c = el("div", "kb-card " + window.TaskColor.cls(x.color));
    if (window.TaskColor.isCustom(x.color)) c.style.setProperty("--tc", x.color);
    c.setAttribute("data-id", x.id);
    var title = el("div", "kb-card__title", x.title);
    c.appendChild(title);
    var meta = el("div", "kb-card__meta");
    if (x.pr === "high") meta.appendChild(el("span", "badge badge--high", t("pr_high")));
    if (x.cat) meta.appendChild(el("span", "badge badge--cat", t("cat_" + x.cat)));
    if (x.due) meta.appendChild(el("span", "badge", dueLabel(x)));
    if (meta.children.length) c.appendChild(meta);
    attachCardDrag(c, x.id);

    /* v6.8 — with one column visible, dragging has nowhere to go. Losing the
     * ability to move a card would be a real regression, so on a phone each
     * card carries an explicit move control instead. Not shown on desktop,
     * where dragging is right there and an extra button is clutter. */
    if (isPhoneView()) {
      var mv = el("div", "kb-card__mv");
      COLS.forEach(function (col) {
        if (col === statusOf(x)) return;
        var b = el("button", "kb-mv", t("kb_" + col));
        b.type = "button";
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          setStatus(x, col);
          if (window.FX && window.FX.haptic) window.FX.haptic("tick");
          ctx.rerender();
          ctx.persistBg();
        });
        mv.appendChild(b);
      });
      c.appendChild(mv);
    }
    c.addEventListener("click", function () { window.TasksView.openById(x.id); });
    c.addEventListener("contextmenu", function (e) {
      if (window.calBlockMenu) window.calBlockMenu(e, x);
    });
    return c;
  }

  /* v6.8 — on a phone the board shows one column at a time.
   *
   * Three columns stacked vertically is what the responsive rule did before,
   * which turns a board into a page three times its own height: to see what
   * is Done you scroll past everything else, and the whole point of a board —
   * seeing the shape of your work at a glance — is gone.
   *
   * A phone shows one column with a switcher above it. The counts sit in the
   * switcher, so the shape is still visible without scrolling, and dragging
   * still works within the visible column. Desktop is untouched.
   */
  var phoneCol = null;   // which column a phone is looking at

  function isPhoneView() {
    return !!(window.matchMedia && window.matchMedia("(max-width: 820px)").matches);
  }

  function colSwitcher(counts) {
    var bar = el("div", "kb-switch");
    bar.setAttribute("role", "tablist");
    COLS.forEach(function (col) {
      var on = (phoneCol || COLS[0]) === col;
      var b = el("button", "kb-switch__b" + (on ? " is-on" : ""));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.appendChild(el("span", "kb-switch__t", t("kb_" + col)));
      b.appendChild(el("span", "kb-switch__n", ctx.num(counts[col] || 0)));
      b.addEventListener("click", function () {
        if (phoneCol === col) return;
        phoneCol = col;
        ctx.rerender();
      });
      bar.appendChild(b);
    });
    return bar;
  }

  function render(host) {
    var phone = isPhoneView();
    if (phone && !phoneCol) phoneCol = COLS[0];

    var tb = el("div", "toolbar");
    if (!phone) {
      // the phone has a persistent add button in the bottom bar already
      var add = el("button", "btn btn--primary btn--sm", t("newTask"));
      add.addEventListener("click", function () { window.TasksView.openNew(null); });
      tb.appendChild(add);
      tb.appendChild(el("span", "cal-hint", t("kb_hint")));
      host.appendChild(tb);
    }

    if (phone) {
      var live0 = tasks().filter(function (x) { return !x.archived; });
      var counts = {};
      COLS.forEach(function (c) {
        counts[c] = live0.filter(function (x) { return statusOf(x) === c; }).length;
      });
      host.appendChild(colSwitcher(counts));
    }

    var board = el("div", "kb-board" + (phone ? " kb-board--one" : ""));
    var live = tasks().filter(function (x) { return !x.archived; });
    COLS.forEach(function (col) {
      if (phone && col !== phoneCol) return;   // one at a time
      var column = el("div", "kb-col");
      column.setAttribute("data-col", col);
      var head = el("div", "kb-col__head kb-col__head--" + col);
      var items = live.filter(function (x) { return statusOf(x) === col; });
      head.appendChild(el("span", "kb-col__name", t("kb_" + col)));
      head.appendChild(el("span", "kb-col__count", ctx.num(items.length)));
      column.appendChild(head);

      var body = el("div", "kb-col__body");
      body.setAttribute("data-col", col);
      // Long columns paginate (B7): render a page, then a "show more" card.
      // Rendering hundreds of cards froze the board; Linear/Trello do the same.
      var PAGE = 30;
      var shown = pageState[col] || PAGE;
      items.slice(0, shown).forEach(function (x) { body.appendChild(card(x)); });
      if (items.length > shown) {
        var more = el("button", "kb-more",
          t("kb_more").replace("{n}", ctx.num(items.length - shown)));
        more.addEventListener("click", function () {
          pageState[col] = shown + PAGE;
          ctx.rerender();
        });
        body.appendChild(more);
      }
      if (!items.length) body.appendChild(el("div", "kb-empty", t("kb_empty")));
      column.appendChild(body);
      board.appendChild(column);
    });
    host.appendChild(board);
  }

  // pointer drag: move a card between columns.
  // v1.13.2 (فاز B مورد ۱۳): the old version waited 250ms on every pointer and
  // paired it with touch-action:none, so on phones the board could never
  // scroll and the lift felt late. Now: vertical pan scrolls natively (CSS
  // touch-action: pan-y), touch lifts after a short 180ms hold with a haptic
  // tick, mouse lifts on plain movement, page scroll is blocked only WHILE a
  // card is in hand, extra fingers are ignored (multi-touch protection), and
  // pointercancel always cleans up.
  function attachCardDrag(cardEl, id) {
    var dragging = false, ghost = null, sx = 0, sy = 0, hold = null;
    var justDragged = false, activeId = null;
    function stopScroll(e) { e.preventDefault(); }
    function cleanup() {
      if (hold) { clearTimeout(hold); hold = null; }
      if (ghost) { ghost.remove(); ghost = null; }
      document.querySelectorAll(".kb-col__body.hot").forEach(function (n) { n.classList.remove("hot"); });
      dragging = false; activeId = null;
      cardEl.classList.remove("kb-card--drag");
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("touchmove", stopScroll);
    }
    function begin(x, y) {
      dragging = true; justDragged = true;
      // while a card is in hand the page must not scroll under it
      document.addEventListener("touchmove", stopScroll, { passive: false });
      if (window.FX && window.FX.haptic) window.FX.haptic("soft");
      cardEl.classList.add("kb-card--drag");
      ghost = cardEl.cloneNode(true);
      ghost.className += " kb-ghost";
      ghost.style.width = cardEl.offsetWidth + "px";
      document.body.appendChild(ghost);
      pos(x, y);
    }
    function pos(x, y) {
      if (ghost) { ghost.style.left = (x + 6) + "px"; ghost.style.top = (y + 6) + "px"; }
      var under = document.elementFromPoint(x, y);
      var body = under && under.closest(".kb-col__body");
      document.querySelectorAll(".kb-col__body.hot").forEach(function (n) { n.classList.remove("hot"); });
      if (body) body.classList.add("hot");
    }
    function move(e) {
      if (e.pointerId !== activeId) return;   // another finger never steals the drag
      if (!dragging) {
        if (Math.abs(e.clientX - sx) > 6 || Math.abs(e.clientY - sy) > 6) {
          if (hold) { clearTimeout(hold); hold = null; }
          if (e.pointerType === "touch") { cleanup(); return; }  // early move = scroll intent
          begin(e.clientX, e.clientY);
        }
        return;
      }
      e.preventDefault(); pos(e.clientX, e.clientY);
    }
    function cancel(e) { if (e.pointerId === activeId) cleanup(); }
    async function up(e) {
      if (e.pointerId !== activeId) return;
      var wasDrag = dragging;
      var under = document.elementFromPoint(e.clientX, e.clientY);
      var body = under && under.closest(".kb-col__body");
      cleanup();
      if (wasDrag && body) {
        var col = body.getAttribute("data-col");
        var x = tasks().find(function (i) { return i.id === id; });
        if (x && statusOf(x) !== col) {
          setStatus(x, col);
          // v5.6: relocate the one node instead of rebuilding the board; fall
          // back to a full render only if the DOM is not what we expect.
          if (!moveCardDom(cardEl, col)) ctx.rerender();
          ctx.persistBg();          // … and save behind it
        }
      }
    }
    cardEl.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      if (activeId !== null) return;
      activeId = e.pointerId;
      sx = e.clientX; sy = e.clientY; justDragged = false;
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", cancel);
      // touch: a short hold lifts the card; mouse: movement alone lifts it
      var bx = e.clientX, by = e.clientY;
      hold = setTimeout(function () { if (!dragging) begin(bx, by); },
        e.pointerType === "touch" ? 180 : 250);
    });
    // dropping a card must not also open its editor
    cardEl.addEventListener("click", function (e) {
      if (justDragged) { justDragged = false; e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  }

  g.KanbanView = { init: init, render: render };
})(window);
