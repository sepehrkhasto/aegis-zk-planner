FONTS — read this, it matters more than it looks.
=================================================

The app is designed for Vazirmatn. Right now this folder is EMPTY, which
means every screen is rendering in a system fallback font. Typography is
the single biggest lever on how expensive a product feels, so adding these
files is the cheapest quality upgrade available to you.

Download the woff2 files from the official release:
  https://github.com/rastikerdar/vazirmatn/releases
(Vazirmatn is free and open source. Self-hosted, so the strict CSP and the
"no external dependencies" promise both stay intact.)

Drop these SIX files here, with exactly these names:

  Vazirmatn-Light.woff2       (300 — quiet secondary text)
  Vazirmatn-Regular.woff2     (400 — body)
  Vazirmatn-Medium.woff2      (500 — labels, buttons)
  Vazirmatn-SemiBold.woff2    (600 — buttons, card titles)
  Vazirmatn-Bold.woff2        (700 — panel titles)
  Vazirmatn-ExtraBold.woff2   (800 — page headings, hero)
  Vazirmatn-Black.woff2       (900 — optional, marketing display)

The CSS already declares all of these weights, plus a metric-adjusted
fallback ("Vazir Fallback") so the moment the real font finishes loading
nothing on the page jumps — no layout shift, no flash of reflowed text.

Until you add them, everything still works; it just won't look as good as
it was designed to.
