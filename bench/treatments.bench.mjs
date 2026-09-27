import { bench, describe } from 'vitest';
import treatments from '../lib/treatments.js';

const golden = treatments.get('golden');

describe('treatments', () => {
  bench('format full recipe (golden)', () => { treatments.format(golden); });
  bench('format every recipe', () => { for (const id of treatments.ids()) treatments.format(treatments.get(id)); });
  bench('formatAll listing', () => { treatments.formatAll(); });
  bench('reviewBrief (golden)', () => { treatments.reviewBrief(golden); });
});
