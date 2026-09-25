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

const TREATMENTS = { golden: GOLDEN };

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
