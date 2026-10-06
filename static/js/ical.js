/* ical.js — export the calendar to a standard .ics file and import .ics files
 * as tasks. Fully client-side: nothing is uploaded, zero-knowledge preserved.
 * Dates are converted Jalali<->Gregorian; timed events use floating local time,
 * all-day / multi-day events use DATE values.
 */
(function (g) {
  "use strict";
  var ctx = null;
  function init(c) { ctx = c; }
  function J() { return ctx.J; }

  function pad(n) { return String(n).padStart(2, "0"); }

  // Jalali {jy,jm,jd} -> "YYYYMMDD" (Gregorian)
  function jToDateStr(j) {
    var gd = J().toGregorian(j.jy, j.jm, j.jd);
    return "" + gd.gy + pad(gd.gm) + pad(gd.gd);
  }
  function jToDateTimeStr(j, hhmm) {
    var gd = J().toGregorian(j.jy, j.jm, j.jd);
    var parts = (hhmm || "00:00").split(":");
    return "" + gd.gy + pad(gd.gm) + pad(gd.gd) + "T" +
      pad(parts[0] || "00") + pad(parts[1] || "00") + "00";
  }
  function addDaysDateStr(dateStr, days) {
    var y = +dateStr.slice(0, 4), m = +dateStr.slice(4, 6), d = +dateStr.slice(6, 8);
    var dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + days);
    return "" + dt.getFullYear() + pad(dt.getMonth() + 1) + pad(dt.getDate());
  }
  function esc(s) {
    return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;")
      .replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }
  function unesc(s) {
    return String(s || "").replace(/\\n/gi, "\n").replace(/\\,/g, ",")
      .replace(/\\;/g, ";").replace(/\\\\/g, "\\");
  }

  function stamp() {
    var d = new Date();
    return "" + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
      "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
  }

  function exportICS() {
    var tasks = (ctx.S.vault.tasks || []).filter(function (x) { return x.due && !x.archived; });
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Secure Planner//FA//EN", "CALSCALE:GREGORIAN"];
    var now = stamp();
    tasks.forEach(function (x) {
      lines.push("BEGIN:VEVENT");
      lines.push("UID:" + x.id + "@secure-planner");
      lines.push("DTSTAMP:" + now);
      lines.push("SUMMARY:" + esc(x.title));
      if (x.notes) lines.push("DESCRIPTION:" + esc(x.notes));
      var multi = x.dueEnd && (x.dueEnd.jy !== x.due.jy || x.dueEnd.jm !== x.due.jm || x.dueEnd.jd !== x.due.jd);
      if (x.timeFrom && !multi) {
        lines.push("DTSTART:" + jToDateTimeStr(x.due, x.timeFrom));
        lines.push("DTEND:" + jToDateTimeStr(x.due, x.timeTo || x.timeFrom));
      } else if (multi) {
        var start = jToDateStr(x.due);
        var end = jToDateStr(x.dueEnd);
        // DTEND is exclusive for all-day events → +1 day
        lines.push("DTSTART;VALUE=DATE:" + start);
        lines.push("DTEND;VALUE=DATE:" + addDaysDateStr(end, 1));
      } else {
        lines.push("DTSTART;VALUE=DATE:" + jToDateStr(x.due));
        lines.push("DTEND;VALUE=DATE:" + addDaysDateStr(jToDateStr(x.due), 1));
      }
      if (x.cat) lines.push("CATEGORIES:" + esc(x.cat));
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  // Parse an .ics string into task-shaped objects.
  function parseICS(text) {
    // unfold folded lines (continuation lines start with space or tab)
    var raw = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
    var lines = raw.split("\n");
    var events = [], cur = null;
    lines.forEach(function (ln) {
      if (ln === "BEGIN:VEVENT") { cur = {}; return; }
      if (ln === "END:VEVENT") { if (cur) events.push(cur); cur = null; return; }
      if (!cur) return;
      var idx = ln.indexOf(":");
      if (idx < 0) return;
      var key = ln.slice(0, idx), val = ln.slice(idx + 1);
      var name = key.split(";")[0].toUpperCase();
      if (name === "SUMMARY") cur.summary = unesc(val);
      else if (name === "DESCRIPTION") cur.description = unesc(val);
      else if (name === "DTSTART") { cur.start = val; cur.startDateOnly = /VALUE=DATE(?!-TIME)/i.test(key) || /^\d{8}$/.test(val); }
      else if (name === "DTEND") { cur.end = val; }
    });
    return events;
  }

  function gToJ(y, m, d) { return J().toJalaali(y, m, d); }

  function eventToTask(ev) {
    if (!ev.start) return null;
    var s = ev.start.replace(/Z$/, "");
    var y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6, 8);
    if (!y || !mo || !d) return null;
    var jStart = gToJ(y, mo, d);
    var task = {
      id: "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title: ev.summary || ctx.T.t("untitled"),
      notes: ev.description || "",
      cat: "", pr: "normal", hz: "", tags: [], rep: "none", link: "",
      color: "c0", goalId: "", subs: [],
      due: { jy: jStart.jy, jm: jStart.jm, jd: jStart.jd },
      done: false, createdAt: new Date().toISOString(), doneAt: null,
      timeFrom: "", timeTo: "", dueEnd: null,
    };
    var tPos = s.indexOf("T");
    if (tPos > 0 && !ev.startDateOnly) {
      task.timeFrom = s.slice(tPos + 1, tPos + 3) + ":" + s.slice(tPos + 3, tPos + 5);
      if (ev.end) {
        var e = ev.end.replace(/Z$/, ""); var eT = e.indexOf("T");
        if (eT > 0) task.timeTo = e.slice(eT + 1, eT + 3) + ":" + e.slice(eT + 3, eT + 5);
      }
    } else if (ev.end) {
      // all-day; DTEND exclusive → subtract a day for the inclusive end
      var e2 = ev.end.replace(/Z$/, "");
      var ey = +e2.slice(0, 4), em = +e2.slice(4, 6), ed = +e2.slice(6, 8);
      if (ey && em && ed) {
        var endDt = new Date(ey, em - 1, ed); endDt.setDate(endDt.getDate() - 1);
        var je = gToJ(endDt.getFullYear(), endDt.getMonth() + 1, endDt.getDate());
        if (je.jy !== jStart.jy || je.jm !== jStart.jm || je.jd !== jStart.jd) {
          task.dueEnd = { jy: je.jy, jm: je.jm, jd: je.jd };
        }
      }
    }
    return task;
  }

  async function importICS(text) {
    var events = parseICS(text);
    var added = 0;
    if (!ctx.S.vault.tasks) ctx.S.vault.tasks = [];
    events.forEach(function (ev) {
      var t = eventToTask(ev);
      if (t) { ctx.S.vault.tasks.push(t); added++; }
    });
    if (added && await ctx.persist()) ctx.rerender();
    return added;
  }

  g.ICal = { init: init, exportICS: exportICS, importICS: importICS, parseICS: parseICS, eventToTask: eventToTask };
})(window);
