/* calsys.js — display-calendar abstraction (Jalali / Gregorian).
 *
 * Storage stays Jalali everywhere ({jy,jm,jd} in the vault). This module only
 * decides how dates are *displayed and navigated*: month grid, week start,
 * titles, and the task date picker. The user picks the system in Settings
 * (sp_calsys = "auto" | "jalali" | "gregorian"); "auto" follows the UI
 * language (fa → Jalali, en → Gregorian) but can be overridden independently.
 */
(function (g) {
  "use strict";

  function prefRaw() {
    try { return localStorage.getItem("sp_calsys") || "auto"; }
    catch (e) { return "auto"; }
  }

  function lang() {
    return (document.documentElement.getAttribute("lang") === "en") ? "en" : "fa";
  }

  // "jalali" | "gregorian"
  function mode() {
    var p = prefRaw();
    if (p === "jalali" || p === "gregorian") return p;
    return lang() === "en" ? "gregorian" : "jalali";
  }
  function isJalali() { return mode() === "jalali"; }

  var J = function () { return g.Jalali; };
  var T = function () { return g.I18N; };

  // ---- conversions (display {y,m,d} <-> Date <-> storage jalali) ----------
  function fromDate(d) {
    if (isJalali()) {
      var j = J().toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
      return { y: j.jy, m: j.jm, d: j.jd };
    }
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  function toDate(disp) {
    if (isJalali()) {
      var gg = J().toGregorian(disp.y, disp.m, disp.d);
      return new Date(gg.gy, gg.gm - 1, gg.gd);
    }
    return new Date(disp.y, disp.m - 1, disp.d);
  }
  // storage jalali -> display
  function jToDisp(j) {
    if (isJalali()) return { y: j.jy, m: j.jm, d: j.jd };
    var gg = J().toGregorian(j.jy, j.jm, j.jd);
    return { y: gg.gy, m: gg.gm, d: gg.gd };
  }
  // display -> storage jalali
  function dispToJ(disp) {
    if (isJalali()) return { jy: disp.y, jm: disp.m, jd: disp.d };
    var jj = J().toJalaali(disp.y, disp.m, disp.d);
    return { jy: jj.jy, jm: jj.jm, jd: jj.jd };
  }

  // ---- month geometry ------------------------------------------------------
  function monthLength(y, m) {
    if (isJalali()) return J().jalaaliMonthLength(y, m);
    return new Date(y, m, 0).getDate();
  }
  function monthNames() {
    return T().t(isJalali() ? "months" : "gmonths");
  }
  function monthName(m) { return monthNames()[m - 1]; }

  // ---- weeks ---------------------------------------------------------------
  // Week starts Saturday in the Jalali system, Monday in the Gregorian one
  // (like Google Calendar's default). dowCol maps a JS Date to its column.
  function weekStartDow() { return isJalali() ? 6 : 1; }
  function dowCol(date) { return ((date.getDay() - weekStartDow()) + 7) % 7; }
  // Holiday column highlight: Friday (Jalali) / Sunday (Gregorian).
  function isHoliday(date) { return date.getDay() === (isJalali() ? 5 : 0); }
  function weekdayShort(colIdx) {
    var dow = (weekStartDow() + colIdx) % 7;
    return T().t("wdShort")[dow];
  }
  function weekdayFull(colIdx) {
    var dow = (weekStartDow() + colIdx) % 7;
    return T().t("wdFull")[dow];
  }
  function weekdayFullOf(date) { return T().t("wdFull")[date.getDay()]; }

  // ---- canonical labels (v1.8.2) -------------------------------------------
  // Every module must format vault dates through these. Formatting a raw
  // {jy,jm,jd} directly is what leaked Persian months/digits into English.
  function digits(n) {
    var s = String(n);
    return (lang() === "fa") ? s.replace(/[0-9]/g, function (d) { return "۰۱۲۳۴۵۶۷۸۹"[+d]; }) : s;
  }
  function label(j) {                      // "12 July" / "۲۱ تیر"
    var d = jToDisp(j);
    return digits(d.d) + " " + monthName(d.m);
  }
  function labelFull(j) {                  // "12 July 2026" / "۲۱ تیر ۱۴۰۵"
    var d = jToDisp(j);
    return digits(d.d) + " " + monthName(d.m) + " " + digits(d.y);
  }
  function labelDate(date) { return label(g.Jalali.toJalaali(
    date.getFullYear(), date.getMonth() + 1, date.getDate())); }

  g.CalSys = {
    digits: digits,
    label: label,
    labelFull: labelFull,
    labelDate: labelDate,
    mode: mode,
    isJalali: isJalali,
    fromDate: fromDate,
    toDate: toDate,
    jToDisp: jToDisp,
    dispToJ: dispToJ,
    monthLength: monthLength,
    monthNames: monthNames,
    monthName: monthName,
    weekStartDow: weekStartDow,
    dowCol: dowCol,
    isHoliday: isHoliday,
    weekdayShort: weekdayShort,
    weekdayFull: weekdayFull,
    weekdayFullOf: weekdayFullOf,
  };
})(window);
