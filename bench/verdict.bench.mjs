import { bench, describe } from 'vitest';
import core from '../lib/core.js';
import polishMod from '../lib/polish.js';
import { DESIGN_VERDICT, BOLD_VERDICT, DELTA_VERDICT, LONG_VERDICT } from './fixtures.mjs';

const { extractFixes, parseScore } = core;
const { topFixes } = polishMod;

describe('verdict parsing: extractFixes (taste memory)', () => {
  bench('design verdict', () => { extractFixes(DESIGN_VERDICT); });
  bench('markdown-bold verdict', () => { extractFixes(BOLD_VERDICT); });
  bench('delta verdict', () => { extractFixes(DELTA_VERDICT); });
  bench('long audit verdict', () => { extractFixes(LONG_VERDICT); });
});

describe('verdict parsing: topFixes (polish loop)', () => {
  bench('design verdict', () => { topFixes(DESIGN_VERDICT); });
  bench('markdown-bold verdict', () => { topFixes(BOLD_VERDICT); });
  bench('long audit verdict', () => { topFixes(LONG_VERDICT); });
});

describe('verdict parsing: parseScore', () => {
  bench('design verdict', () => { parseScore(DESIGN_VERDICT); });
  bench('markdown-bold verdict', () => { parseScore(BOLD_VERDICT); });
  bench('long audit verdict', () => { parseScore(LONG_VERDICT); });
});
