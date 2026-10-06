"""Static-files storage for production.

Two problems solved in one class.

1. A DEPLOY-BLOCKING CRASH.
   The Vazirmatn font files are deliberately not in this repository (licence
   and size — see static/fonts/README.txt), but app.css references them so a
   deployment that DOES ship them gets the real typeface. Django's default
   ManifestStaticFilesStorage treats any unresolvable url() in CSS as fatal,
   so `collectstatic` used to abort every fresh production deploy with:

       ValueError: The file 'fonts/Vazirmatn-Regular.woff2' could not be found

   Note that `manifest_strict = False` alone does NOT fix this: that flag
   only affects template lookups, while the crash happens during CSS
   post-processing. hashed_name() has to be made forgiving too.

2. NO COMPRESSION (found in the v3.0.3 frontend audit).
   settings.py used to set STORAGES twice — once inside the WhiteNoise block
   to CompressedStaticFilesStorage, and again immediately below,
   unconditionally. The second assignment won, so compression never happened
   and ~830 KB of uncompressed JS and CSS went over the wire on first load.
   On a slow mobile connection that is the difference between a couple of
   seconds and a dozen. Basing the class on WhiteNoise's compressed storage
   (when installed) writes .gz and .br alongside each file at collect time.
"""

try:  # pragma: no cover - depends on the deployment environment
    from whitenoise.storage import CompressedManifestStaticFilesStorage as _Base
except ImportError:  # WhiteNoise not installed: keep working, just uncompressed
    from django.contrib.staticfiles.storage import ManifestStaticFilesStorage as _Base


class ForgivingManifestStaticFilesStorage(_Base):
    # tolerate a missing entry when a template looks one up …
    manifest_strict = False

    # ------------------------------------------------------------------ #
    # 3. COMMENTS ON THE WIRE (v5.7).
    #    app.js carries ~29 KB of comments — 15% of the file. They are why
    #    someone reading this code later can tell WHY a thing is the way it
    #    is, so deleting them from the source to satisfy a size budget would
    #    trade permanent knowledge for a few kilobytes. They are a
    #    development artefact, not a runtime one: they belong in the
    #    repository, not on someone's data plan. So they are stripped here,
    #    during collectstatic, from the served copy only.
    #
    #    Terser parses the file rather than pattern-matching it, because
    #    stripping JS comments with a regex silently corrupts code:
    #    "http://x" inside a string and a regex literal containing /* both
    #    look like comment openers. If Node or terser is absent — a plain
    #    pip-only deploy — files pass through untouched with a warning. A
    #    missing optimiser must never be the reason a deploy fails.
    # ------------------------------------------------------------------ #
    STRIP_SKIP = ("i18n.fa.js", "i18n.en.js")

    def post_process(self, paths, dry_run=False, **options):
        if not dry_run:
            _strip_js_comments(self, paths, self.STRIP_SKIP)
            _strip_css_comments(self, paths)
        yield from super().post_process(paths, dry_run=dry_run, **options)

    # … and, crucially, when CSS post-processing hits a url() that points at a
    # file we do not ship. Falling back to the original name leaves the
    # reference intact and lets the rest of the collection finish.
    def hashed_name(self, name, content=None, filename=None):
        try:
            return super().hashed_name(name, content, filename)
        except ValueError:
            return name


# --------------------------------------------------------------------------- #
# Comment stripping (v5.7)
# --------------------------------------------------------------------------- #
import json          # noqa: E402
import shutil        # noqa: E402
import subprocess    # noqa: E402
import tempfile      # noqa: E402
from pathlib import Path   # noqa: E402

_STRIP_SCRIPT = r"""
const terser = require("terser");
const fs = require("fs");
(async () => {
  const src = fs.readFileSync(process.argv[2], "utf8");
  try {
    const out = await terser.minify(src, {
      // Comments only. No renaming, no reordering, no dead-code removal: the
      // served file should stay recognisably the file that was written, so a
      // production stack trace still points somewhere useful.
      compress: false,
      mangle: false,
      format: { comments: false, beautify: true, indent_level: 0 },
    });
    if (out.code) { fs.writeFileSync(process.argv[3], out.code); process.exit(0); }
    process.exit(2);
  } catch (e) { console.error(String(e)); process.exit(3); }
})();
"""


def _terser_available() -> bool:
    if shutil.which("node") is None:
        return False
    try:
        from django.conf import settings as dj
        r = subprocess.run(["node", "-e", "require.resolve('terser')"],
                           cwd=str(dj.BASE_DIR), capture_output=True, timeout=20)
        return r.returncode == 0
    except Exception:
        return False


def _strip_js_comments(storage, paths, skip):
    if not _terser_available():
        print("  ! terser not found — serving JS with comments "
              "(install Node + `npm install terser` to strip them)")
        return
    saved = 0
    # The helper must live inside the project, not in /tmp: Node resolves
    # `require("terser")` by walking up from the SCRIPT's directory, so a
    # script in a temp dir can never find the project's node_modules. This
    # cost a silent no-op where every file reported "could not strip".
    from django.conf import settings as dj
    with tempfile.TemporaryDirectory(dir=str(dj.BASE_DIR)) as tmp:
        script = Path(tmp) / "strip.js"
        script.write_text(_STRIP_SCRIPT, encoding="utf-8")
        for name in list(paths):
            if not name.endswith(".js") or name.endswith(skip):
                continue
            try:
                path = Path(storage.path(name))
            except Exception:
                continue
            if not path.exists():
                continue
            before = path.stat().st_size
            out = Path(tmp) / "out.js"
            if out.exists():
                out.unlink()
            try:
                r = subprocess.run(["node", str(script), str(path), str(out)],
                                   capture_output=True, timeout=120)
            except Exception:
                continue
            if r.returncode != 0 or not out.exists():
                # A file that will not parse is left exactly as it was:
                # serving the original beats serving something mangled.
                print(f"  ! could not strip {name}, left unchanged")
                continue
            path.write_bytes(out.read_bytes())
            saved += before - path.stat().st_size
    if saved:
        print(f"  stripped {saved/1024:.0f} KB of comments from served JS")


def _strip_css_comments(storage, paths):
    """Remove /* */ comments from served CSS.

    app.css carries the same kind of long-form rationale as app.js — why a
    divider token exists, what was measured before a rule was written. That
    belongs in the repository, not in every page load.

    A regex is safe HERE in a way it is not for JavaScript: CSS has no regex
    literals and no line comments, so the only place a `/*` can appear without
    opening a comment is inside a string or a url(). Those are checked for
    explicitly and the file is left alone if any are found, because a
    stylesheet that comes out subtly wrong is worse than one that is simply
    bigger.
    """
    import re
    saved = 0
    for name in list(paths):
        if not name.endswith(".css"):
            continue
        try:
            path = Path(storage.path(name))
        except Exception:
            continue
        if not path.exists():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        # a `/*` inside a quoted string or url() means hands off
        # Must match a /* INSIDE a string, not a string that merely shares a
        # line with a comment: the loose version flagged `content: ""; /* … */`
        # and skipped the file entirely.
        risky = re.search(
            r'"(?:[^"\\\n]|\\.)*/\*(?:[^"\\\n]|\\.)*"'
            r"|'(?:[^'\\\n]|\\.)*/\*(?:[^'\\\n]|\\.)*'"
            r'|url\([^)"\']*/\*',
            text)
        if risky:
            print(f"  ! {name} has /* inside a string or url(), left unchanged")
            continue
        before = len(text.encode("utf-8"))
        out = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        # collapse the blank lines the removal leaves behind
        out = re.sub(r"\n{3,}", "\n\n", out)
        path.write_text(out, encoding="utf-8")
        saved += before - len(out.encode("utf-8"))
    if saved:
        print(f"  stripped {saved/1024:.0f} KB of comments from served CSS")
