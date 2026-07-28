# Heightcast

An honest adult-height estimator. Static site — no build step, no dependencies, no analytics,
no external requests (the font is self-hosted, the icons are inline SVG).

**The site collects nothing.** There is no form that posts anywhere, no email capture, no
cookies, no tracking, no server-side anything. Every measurement is calculated in the visitor's
browser and never uploaded. This is deliberate: the audience includes minors, so the only
COPPA/UK-AADC-safe design is one where no personal data is collected at all.

## What works

- **The estimator.** Three published methods run on every submission:
  - Khamis-Roche (1994, errata 1995) — the headline range, ±90% band
  - Mid-parental / Tanner target height
  - CDC 2000 stature-for-age percentile projection (LMS)
  The headline is a *range*, never a single fake-confident number.
- **Validation** for ages 4–17 with plain-English rejections and warnings.
- **Unit switching** (ft/in · lb ↔ cm · kg) converts entered values in place.
- **Shareable poster card** — drawn on a canvas, downloads as a 1080×1350 PNG.
- **`privacy.html`** — the zero-collection privacy note, plain enough for a 14-year-old.
- **`terms.html`** — terms and the honest disclaimer (estimate not measurement, not medical
  advice, no guarantee, nothing makes you taller).
- 41 unit tests over the pure math modules: `npm test` (node's built-in runner, no deps).

## Deliberately absent

- **No email capture, no waitlist, no contact form.** Removed July 28, 2026 after a pre-launch
  audit: an audience that includes 4–17-year-olds plus an email field is COPPA and UK
  Age-Appropriate-Design-Code exposure for no real benefit. The section that held it is now the
  "Your numbers stay on your device" block — the honest answer to "what happens to what I
  typed", not a disabled form. Do not re-add a signup box without a lawyer's read.
- **No analytics of any kind**, first- or third-party. If visit counts are ever wanted, use the
  host's own server-side request logs — never a script in the page.
- **No email address anywhere in the served tree.** `grep -rn "@" *.html` should never find one.

## Not built

- **The Heightcast app itself** (growth tracked over time) does not exist, and the site no
  longer mentions or promises it.
- **GitHub Pages is not enabled** on this repo, so there is no public URL yet.
- ⚠️ **`boards/` is untracked but still in git history** (commits `7bfdd22`/`2ea7e63`). It names
  internal AI tooling and cost. The repo is private today; **before it is ever made public,
  either keep it private or rewrite history** — untracking alone does not remove it.

## Local development

```sh
npm test        # 41 unit tests, node --test, zero dependencies
npm run serve   # python3 -m http.server 8080
```

## Honesty rules this repo follows

No fabricated signup counts, ratings, or testimonials. No "grow taller" claims, supplements, or
affiliate links — the FAQ says outright that nothing increases adult height after the growth
plates close. The estimate is labelled an estimate, not medical advice, everywhere it appears.

## Sources

Khamis HJ, Roche AF. *Pediatrics* 1994;94:504–507 (errata 1995;95:457) ·
Tanner mid-parental target height · CDC 2000 stature-for-age growth charts ·
heritability ≈0.8 from Silventoinen et al. twin studies and Yengo et al., *Nature* 2022.
