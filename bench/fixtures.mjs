// Realistic model output used by the benchmarks. Kept offline and deterministic:
// no network, no API keys, no child processes.

export const DESIGN_VERDICT = `VERDICT: NEAR SHIP — strong hierarchy, mobile reflow breaks it.
SCORE: 78/100
WHAT WORKS:
- Hero photography carries the brand; the serif/sans pairing is disciplined.
- Section rhythm is consistent (96px desktop, 56px mobile).
- One accent colour on the primary CTA.

TOP 3 FIXES:
1. Hero heading: 44px on mobile overflows — drop to clamp(28px, 8vw, 44px).
2. CTA button below the fold at 390px — move above the testimonial row.
3. 4 accent colours on one page — keep the gold, mute the rest.

MOBILE: nav hamburger tap target is 28px; raise to 44px. Testimonials carousel overflows by 12px.`;

export const BOLD_VERDICT = `**VERDICT:** NOT SHIPPABLE — the page reads generic and the CTA is invisible.
**SCORE:** **54** / 100

**What works:**
- Clean grid.

**Top 3 fixes:**
1. Replace the stock hero with the client's own ceremony photo, cropped 16:9.
2. Primary CTA: raise contrast to 4.5:1 and move it into the hero.
3. Adopt the golden treatment: gold eyebrow + hairline rule per section.

**MOBILE:** clean.`;

const previous = DESIGN_VERDICT;
export const DELTA_VERDICT = `CHANGED: hero heading resized, CTA moved above testimonials, accent palette reduced.
FIXES LANDED:
- "Hero heading: 44px on mobile overflows" — DONE
- "CTA button below the fold at 390px" — PARTIAL (moved, still below fold on 360px)
- "4 accent colours on one page" — OPEN
STILL OPEN:
- Accent colours: teal and coral still used in the footer and pricing cards.
VERDICT: NEAR SHIP — two of three fixes landed.
SCORE: 84/100
TOP 3 FIXES:
1. Remove teal/coral from footer + pricing cards; gold only.
2. At 360px, reduce hero padding-top from 120px to 72px so the CTA clears the fold.
3. Tighten testimonial line-height from 1.9 to 1.55.
MOBILE: clean.

--- PREVIOUS ---
${previous}`;

// A long audit-style verdict: many per-page lines before the fixes section.
export const LONG_VERDICT = [
  'PER-PAGE:',
  ...Array.from({ length: 120 }, (_, i) => `[${i + 1}] /page-${i + 1}: NEAR SHIP — spacing drift in section ${i % 7}, hero contrast ${3 + (i % 3)}.1:1.`),
  'SCORE: 71/100',
  'CROSS-PAGE CONSISTENCY:',
  ...Array.from({ length: 40 }, (_, i) => `- nav behaviour differs on /page-${i * 3}: sticky vs static; footer CTA moves ${i * 4}px.`),
  'TOP 3 FIXES:',
  '1. Unify the nav: sticky on every page, 72px tall, same logo lockup.',
  '2. One type scale site-wide: 1.25 ratio, 18px base.',
  '3. Footer CTA identical on every page — same copy, same colour, same position.',
  'VERDICT: NEAR SHIP — consistent brand, inconsistent chrome.',
].join('\n');

export const HEALTH_CLEAN = { httpErrors: [], brokenImages: [], pendingImages: 0, consoleErrors: [], pageErrors: [] };

export const HEALTH_NOISY = {
  httpErrors: Array.from({ length: 40 }, (_, i) => ({ status: i % 2 ? 404 : 500, url: `https://cdn.example.com/assets/very/long/path/to/resource-${i}.webp?v=${'x'.repeat(40)}` })),
  brokenImages: Array.from({ length: 25 }, (_, i) => ({ src: `https://cdn.example.com/gallery/wedding-${i}-large-${'y'.repeat(60)}.jpg` })),
  pendingImages: 7,
  consoleErrors: Array.from({ length: 12 }, (_, i) => `TypeError: cannot read property ${i}`),
  pageErrors: ['ReferenceError: gtag is not defined'],
};
