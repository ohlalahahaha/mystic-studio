import { bench, describe } from 'vitest';
import core from '../lib/core.js';
import { HEALTH_CLEAN, HEALTH_NOISY } from './fixtures.mjs';

const { formatHealth } = core;

describe('page health: formatHealth', () => {
  bench('clean capture', () => { formatHealth(HEALTH_CLEAN); });
  bench('noisy capture (HTTP errors, broken images, console errors)', () => { formatHealth(HEALTH_NOISY); });
  bench('missing sidecar', () => { formatHealth({ missing: 'page-health sidecar not written: /tmp/x.png.health.json' }); });
});
