/* panel_i18n.js — English localization for the admin panel pages.
 * The panel is server-rendered in Persian; when the user's saved UI language
 * (sp_lang, same preference as the app) is English, this swaps every static
 * label marked with data-l / data-l-ph. CSP-safe: external file, no inline JS.
 * Dynamic Django data (usernames, dates, model display values) is untouched.
 */
(function () {
  "use strict";
  var lang;
  try { lang = localStorage.getItem("sp_lang") || "fa"; } catch (e) { lang = "fa"; }

  /* v3.4.1 (فاز ۲): the panel had no language switch at all — the app's lives
   * inside the vault UI, so staff landing straight on /panel/ were stuck.
   * The button is wired BEFORE the early return, so it works in both
   * directions; prefs.js already applies lang/dir from the same key. */
  function wireLangButton() {
    var b = document.getElementById("pnl-lang");
    if (!b) return;
    b.textContent = (lang === "en") ? "فارسی" : "EN";
    b.addEventListener("click", function () {
      var next = (lang === "en") ? "fa" : "en";
      try { localStorage.setItem("sp_lang", next); } catch (e) {}
      location.reload();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireLangButton);
  } else { wireLangButton(); }

  if (lang !== "en") return;

  var EN = {
    // base chrome
    panelTitle: "Admin Panel",
    navHome: "Dashboard",
    navUsers: "Users",
    navInvites: "Invite codes",
    navFeedback: "Feedback",
    navBroadcasts: "Broadcasts",
    openApp: "App",
    logout: "Log out",
    zkNote: "This panel only manages accounts; user content is end-to-end encrypted and nobody — including this panel — can read it.",
    // home
    stTotalUsers: "Total users",
    stApprovedUsers: "Approved",
    stPending: "Awaiting approval",
    stVaults: "Vaults created",
    stActiveInvites: "Active invite codes",
    hPending: "Awaiting approval",
    hRecent: "Recent sign-ups",
    approve: "Approve",
    stApproved: "Approved",
    stWaiting: "Pending",
    stAdmin: "Admin",
    stInactive: "Inactive",
    // users
    hAllUsers: "All users",
    thUsername: "Username",
    thJoined: "Joined",
    thLastSeen: "Last activity",
    // v5.0 — attention strip
    atPending: "accounts waiting for approval",
    atPendingS: "They can't get in until you approve them.",
    atReview: "Review",
    atOpenReg: "Registration is open without an invite code",
    atAutoWin: "The auto-approve window is open",
    atUntil: "until",
    atUsed: "created",
    atLeft: "slots left",
    atCloseNow: "Close it now",
    atAllClear: "All quiet",
    atAllClearS: "Nothing waiting for approval, and no door left open.",
    // registration control
    hRegControl: "Registration control",
    rgAuto: "Auto-approve",
    rgAutoS: "An invite code is still needed \u2014 manual approval isn't.",
    rgOpen: "Registration without an invite code",
    rgOpenS: "The widest door. For testing and promotional sign-ups \u2014 with a deadline and a cap.",
    rgClosed: "Closed",
    rgHours: "hours",
    rgDays: "days of access",
    rgMax: "account cap",
    rgNeedsApproval: "Still require manual approval",
    rgWarn: "24 hours maximum. The window closes itself once the cap is reached.",
    btnSave: "Save",
    // reports
    navReports: "Reports",
    rpTitle: "Reports",
    rpLede: "Last 30 days. Every number comes from a recorded event, not an estimate.",
    rpRoutes: "How people signed up",
    rpTotalSignups: "Total sign-ups",
    rpNoSignups: "No sign-ups in the last 30 days.",
    rpIntent: "Purchase intent",
    rpIntentNote: "These are Telegram button clicks, not sales \u2014 how many people reached the edge of buying.",
    rpPlan: "Plan",
    rpReaches: "Count",
    rpValue: "Potential value",
    rpNoIntent: "Nobody has clicked buy yet.",
    rpEvents: "Recent sign-ups",
    rpRoute: "Route",
    rpCode: "Code",
    rpDays: "Days",
    rpWhen: "When",
    rpNone: "Nothing recorded.",
    rpSeen: "Recent activity",
    rpSeenNote: "This is when someone was last seen, not a login log \u2014 the stamp is written at most once an hour on purpose, so nothing accumulates that could track behaviour.",
    stPremOn: "Active",
    stPremOff: "Expired",
    // v5.2 — backup console
    navBackup: "Backup",
    bkTitle: "Backup",
    bkLede: "A complete export of the database \u2014 every account and every vault \u2014 in one encrypted file.",
    bkWarnT: "This file is the most valuable thing you will ever produce.",
    bkWarnS: "Vault contents stay encrypted and we can never read them. But the file holds every user's password hash and their wrapped recovery keys, and anyone holding it can work on those offline, at leisure. That is why it is encrypted with a separate passphrase \u2014 and why, without that passphrase, nobody opens it. Including you.",
    bkContents: "What's inside",
    bkTable: "Table", bkRows: "Rows", bkTotal: "Total",
    bkExport: "Export",
    bkLoginPw: "Your login password",
    bkPass: "File passphrase",
    bkPass2: "Repeat passphrase",
    bkExportBtn: "Download encrypted file",
    bkExportNote: "Keep the passphrase somewhere safe. If you lose it the file can never be opened again \u2014 there is no workaround and no recovery.",
    bkImport: "Restore",
    bkImportNote: "Restoring REPLACES the current contents of every table above. A snapshot of the current state is taken and saved first, so a wrong file is still reversible.",
    bkFile: "Backup file",
    bkConfirm: "Type RESTORE to confirm",
    bkImportBtn: "Restore",
    bkSnaps: "Pre-restore snapshots",
    bkSnapsNote: "Created automatically just before each restore, with the passphrase you entered at the time. The last ten are kept.",
    bkSnapName: "File", bkSnapWhen: "When", bkSnapSize: "Size", bkDownload: "Download",
    bkReplaces: "replaces",
    atAria: "Needs attention",
    atAriaOk: "Status",
    thStatus: "Status",
    deactivate: "Deactivate",
    btnExtend: "+30 days",
    stDays: "days",
    stUnlimited: "unlimited",
    stExpiredSub: "Sub expired",
    activate: "Activate",
    // invites
    hNewInvite: "Create invite code",
    lbLabel: "Label (optional)",
    phLabel: "e.g. for Ali",
    lbMaxUses: "Max uses",
    lbExpiry: "Expiry (days; 0 = never)",
    btnCreate: "Create",
    hInvites: "Existing codes",
    thCode: "Code",
    thLabel: "Label",
    thUses: "Uses",
    stActive: "Active",
    stOff: "Off",
    stExpired: "Expired",
    stUsedUp: "Used up",
    stUntil: "until",
    btnOff: "Turn off",
    btnOn: "Turn on",
    emptyInvites: "No codes created yet.",
    // broadcasts
    hSendAll: "Send a broadcast to all users",
    bcNote: "This message appears in every user's notification center (the bell at the top of the app).",
    lbTitle: "Title",
    lbBody: "Body (optional)",
    lbLevel: "Type",
    optInfo: "Info",
    optSuccess: "Good news",
    optWarning: "Warning",
    btnSendAll: "Send to everyone",
    navPurchases: "Purchase requests",
    puTitle: "Subscription purchase requests",
    puSub: "From the public form on the home page. Mark them handled to keep the queue clean.",
    puName: "Name", puPhone: "Phone", puEmail: "Email", puNote: "Note",
    puWhen: "Received", puState: "Status", puDone: "Handled", puNew: "New",
    puToggle: "Toggle status", puDelete: "Delete",
    puEmpty: "No requests yet.",
    hBroadcasts: "Sent broadcasts",
    btnDisable: "Disable",
    btnEnable: "Enable",
    btnDelete: "Delete",
    emptyBroadcasts: "No broadcasts yet.",
    // feedback
    fbNote: "These messages are anonymous and not linked to any user.",
    emptyFeedback: "No feedback yet.",
    // v3.2.3 — six labels the completeness guard caught on its first run:
    // they stayed Persian in EN mode since the day they shipped.
    stPremActive: "Active subscriptions",
    stActive7: "Active · 7 days",
    stActive30: "Active · 30 days",
    // auto-registration window
    hAutoApprove: "Auto-registration",
    autoOpenNote: "Open now — new sign-ups are activated without manual approval.",
    autoClosedNote: "Closed — every sign-up must be approved by hand.",
    autoUntil: "Open until",
    phHours: "hours",
    btnOpenWindow: "Open",
    btnCloseWindow: "Close",
    hExpiring: "Expiring this week",
    thDaysLeft: "Days left",
    thUntil: "Until",
    btnApply: "Apply",
    btnLog: "History",
    // v3.4.1 (فاز ۲): sixteen strings had NO data-l at all, so they could
    // never be translated — premium_log.html was almost entirely Persian in
    // English mode. The completeness guard only checked that existing keys
    // had translations, not that visible text was markable; it does both now.
    btnSearch: "Search",
    btnClear: "Clear",
    phUserSearch: "Search username…",
    phDays: "±days",
    phReason: "Reason (optional)",
    outOf5: "5",
    plTitle: "Subscription history",
    plNow: "Current status:",
    plActive: "Active",
    plInactive: "Inactive",
    plDaysLeft: "days left",
    plUntil: "until",
    plForever: "No expiry",
    plExpiredSince: "expired since",
    plThWhen: "When",
    plThChange: "Change",
    plThAfter: "Valid until (after)",
    plThAdmin: "Admin",
    plThReason: "Reason",
    plEmpty: "No changes recorded yet.",
    plBack: "\u2039 Back to users",
    ariaLang: "Switch language",
  };
  // "بازخوردهای ناشناس (N)" keeps its count → handled with a prefix key
  var PREFIX = { hFeedback: "Anonymous feedback " };

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-l]").forEach(function (n) {
      var k = n.getAttribute("data-l");
      if (EN[k] !== undefined) n.textContent = EN[k];
      else if (PREFIX[k] !== undefined) {
        // keep any trailing "(N)" produced by the template
        var m = (n.textContent || "").match(/\(([^)]*)\)\s*$/);
        n.textContent = PREFIX[k] + (m ? "(" + m[1] + ")" : "");
      }
    });
    document.querySelectorAll("[data-l-ph]").forEach(function (n) {
      var k = n.getAttribute("data-l-ph");
      if (EN[k] !== undefined) n.placeholder = EN[k];
    });
    /* v3.4.1: screen-reader labels were the one visible-to-users string type
     * the applier could not reach. */
    document.querySelectorAll("[data-l-aria]").forEach(function (n) {
      var k = n.getAttribute("data-l-aria");
      if (EN[k] !== undefined) n.setAttribute("aria-label", EN[k]);
    });
  });
})();
