'use strict';
// Signature treatments — proven premium idioms extracted from shipped builds.
// A treatment is applied whole: tokens AND guards together, one per page.
// web_review judges within a declared treatment's idiom instead of demanding
// generic minimalism, so the next job starts at "already good".

const GOLDEN = {
  id: 'golden',
  name: 'The Golden Treatment',
  provenance: 'Lee Vu bilingual wedding MC (mcleevusydney.com), shipped 2026-09-25.',
  use_for: ['luxury evening / ceremony brands', 'bilingual formal', 'candlelit photography'],
  never_for: ['tech SaaS', 'bright or airy family brands'],
  css: `:root{
  --ink:#0c1420; --ink-2:#101c2b;                 /* deep navy base      */
  --gold:#c8a45f; --gold-2:#e7d2a2; --gold-3:#9a7a3f; --gold-deep:#a5854a;
  --cream:#f1ebdd; --paper:#fcf9f1;               /* ivory light base    */
  --line:rgba(200,164,95,.30); --line-soft:rgba(200,164,95,.15);
  --serif:'Cormorant Garamond',Georgia,serif;
  --sans:'Jost','Avenir Next',Verdana,sans-serif;
  --script:'Pinyon Script',cursive;               /* role-locked accent  */
  --ease:cubic-bezier(.22,1,.36,1);
}
.gold-text{font-family:var(--script);font-weight:400;
  background:linear-gradient(105deg,var(--gold-2) 8%,var(--gold) 55%,var(--gold-3) 96%);
  -webkit-background-clip:text;background-clip:text;color:transparent;padding-right:.14em}
.eyebrow{font-size:.6875rem;letter-spacing:.42em;text-transform:uppercase;color:var(--gold)}
.rule{width:4.5rem;height:1px;background:linear-gradient(90deg,var(--gold),transparent)}`,
  moves: [
    'One gold-script keyword per section max ("Sydney.", "the golden hour") — never body text; slight rotate only at hero scale.',
    'Shimmer = slow background-position sweep on the .gold-text gradient only.',
    'Letterspaced gold eyebrow + hairline rule opens each section.',
    "Candlelight glow: one radial rgba(226,168,84,.32 → 0), blur(14px), anchored to the photo's real light source.",
    'Hairline gold→transparent rules instead of boxes and dividers.',
    'Gold text only on ink/navy; on ivory surfaces gold drops to eyebrows + hairlines.',
  ],
  guards: [
    'Gold stays ~5% of the pixels.',
    '3–5 golden moments per page, not every surface.',
    'The glow follows real light; it never decorates empty corners.',
    'Faces stay natural — no gold cast on skin.',
  ],
};

const IVORY = {
  id: 'ivory',
  name: 'The Ivory Treatment',
  provenance: 'Mystic Wellness & Anthropic brand lane, extracted from estate design law (flower-touch).',
  use_for: ['editorial brands', 'thought leadership', 'wellness', 'curated publishing'],
  never_for: ['dark-mode tech SaaS', 'neon gaming', 'high-gloss e-commerce'],
  css: `:root{
  --bg:#faf9f5; --bg-card:#f0eee6;
  --ink:#141413; --ink-muted:#6b6963;
  --accent:#d97757; --accent-soft:#d4a27f;
  --line:rgba(20,20,19,.12); --line-soft:rgba(20,20,19,.06);
  --serif:'Charter','Georgia',serif;
  --sans:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --ease:cubic-bezier(.2,.8,.4,1);
}
.accent-text{color:var(--accent)}
.eyebrow{font-size:.75rem;letter-spacing:.15em;text-transform:uppercase;color:var(--ink-muted);font-weight:600}`,
  moves: [
    'Ivory canvas (#faf9f5), never stark pure white (#ffffff).',
    'One terracotta accent (#d97757), reserved strictly for the primary action or single lead thesis keyword.',
    'Humanist serif display (Charter/Georgia) with clean grotesque sans body.',
    'Newsroom cards: subtle border (line-soft), radius 8–12px, single elevation level max.',
    'Photographic texture over flat gradients; 8px spacing rhythm throughout.',
  ],
  guards: [
    'Terracotta accent covers <3% of viewport pixels.',
    'No light gray on white; text contrast ratio must exceed 4.5:1.',
    'No purple-blue gradients, glassmorphism, or fake 3D.',
  ],
};

const OCEAN = {
  id: 'ocean',
  name: 'The Ocean Depth Treatment',
  provenance: 'Phoenix Digital Systems underwater world (phoenixdigitalsystems.com).',
  use_for: ['cinematic tech', 'deep-tech platforms', 'atmospheric interactive worlds'],
  never_for: ['wedding formal', 'bright daylight retail', 'ivory editorial'],
  css: `:root{
  --abyss:#050d1a; --abyss-surface:#0a192f;
  --cyan:#00e5ff; --cyan-glow:rgba(0,229,255,.25);
  --marine:#0077b6; --marine-dark:#023e8a;
  --text-pure:#e6f1ff; --text-dim:#8892b0;
  --line-cyan:rgba(0,229,255,.20);
  --display:'Space Grotesk',system-ui,sans-serif;
  --mono:'JetBrains Mono',monospace;
}
.biolum{color:var(--cyan);text-shadow:0 0 16px var(--cyan-glow)}`,
  moves: [
    'Deep oceanic background (#050d1a) with dimensional atmosphere.',
    'Bioluminescent cyan (#00e5ff) for primary interactive highlights and precision accents.',
    'Layered depth: deep marine gradients with subtle ambient lighting rather than flat black.',
    'Crisp monospace metadata chips paired with confident display geometry.',
  ],
  guards: [
    'Cyan glow strictly contained to interactive targets and hero focal points.',
    'Maintain deep contrast; background never washes out into generic grey.',
    'Atmosphere supports hierarchy; never obstructs core copy or controls.',
  ],
};

const TREATMENTS = { golden: GOLDEN, ivory: IVORY, ocean: OCEAN };

const ids = () => Object.keys(TREATMENTS);
const get = (id) => TREATMENTS[id];

function format(t) {
  return [
    `${t.name} [${t.id}]`,
    `provenance: ${t.provenance}`,
    `use for: ${t.use_for.join(' · ')}`,
    `never for: ${t.never_for.join(' · ')}`,
    '',
    'TOKENS:',
    t.css,
    '',
    'MOVES:',
    ...t.moves.map((m, i) => `${i + 1}. ${m}`),
    '',
    'GUARDS:',
    ...t.guards.map((g) => `- ${g}`),
    '',
    `Apply whole — tokens AND guards together, one treatment per page. Declare it to web_review as {"treatment":"${t.id}"} so the verdict judges within the idiom.`,
  ].join('\n');
}

const formatAll = () => ids().map((id) => {
  const t = TREATMENTS[id];
  return `${t.name} [${t.id}] — ${t.use_for[0]}. never: ${t.never_for.join(' / ')}. full recipe: treatments {"name":"${id}"}`;
}).join('\n');

const reviewBrief = (t) => [
  `SIGNATURE TREATMENT — this page declares "${t.name}". Judge within this idiom: its accent budget and restrained signature moves are deliberate design, not timidity — never demand generic minimalism against a declared treatment, but DO flag drift past its guards.`,
  `Moves expected: ${t.moves.join(' ')}`,
  `Guards to enforce: ${t.guards.join(' ')}`,
].join('\n');

module.exports = { TREATMENTS, ids, get, format, formatAll, reviewBrief };
