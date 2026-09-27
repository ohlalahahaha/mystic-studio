import { bench, describe } from 'vitest';
import polishMod from '../lib/polish.js';
import { DESIGN_VERDICT, DELTA_VERDICT } from './fixtures.mjs';

const { polish } = polishMod;
const SHIP = 'VERDICT: SHIP — every fix landed.\nSCORE: 93/100';
const STALLED = 'CHANGED: nothing visible\nFIXES LANDED:\n- "a" — OPEN\n- "b" — OPEN\n- "c" — OPEN\nVERDICT: NEAR SHIP';

// polish() is pure orchestration; every side effect arrives via the api object,
// so the whole review -> runner -> delta loop runs offline with in-memory stubs.
function stubApi(deltas) {
  let i = 0;
  const steps = [];
  return {
    newId: () => 'bench-polish',
    review: () => DESIGN_VERDICT,
    runContract: (repo, profile, contract) => ({ verdict: 'SHIP', output: contract }),
    delta: () => deltas[Math.min(i++, deltas.length - 1)],
    saveStep: (id, text) => { steps.push(text); },
  };
}

const args = { url: 'https://example.com', repo: '/srv/site', brief: 'landing page for a wedding MC', maxRounds: 6 };

describe('polish loop (stubbed side effects)', () => {
  bench('ships after 3 rounds', () => { polish({}, args, stubApi([DELTA_VERDICT, DELTA_VERDICT, SHIP])); });
  bench('runs to max rounds (6)', () => { polish({}, args, stubApi([DELTA_VERDICT])); });
  bench('stops on stalled delta', () => { polish({}, args, stubApi([STALLED])); });
});
