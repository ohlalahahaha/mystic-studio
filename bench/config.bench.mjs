import { bench, describe } from 'vitest';
import os from 'os';
import path from 'path';
import cfg from '../lib/config.js';

// Minimal config object: isAllowedPath only reads outDir + allowDirs.
const base = { outDir: path.join(os.tmpdir(), 'mystic-bench-out'), allowDirs: [] };
const many = { ...base, allowDirs: Array.from({ length: 50 }, (_, i) => `/srv/media/library-${i}`) };
const inside = path.join(os.tmpdir(), 'shots', 'hero-1280.png');
const outside = '/etc/passwd';

describe('config: isAllowedPath (media read allowlist)', () => {
  bench('allowed path, default dirs', () => { cfg.isAllowedPath(base, inside); });
  bench('blocked path, default dirs', () => { cfg.isAllowedPath(base, outside); });
  bench('blocked path, 50 allowDirs', () => { cfg.isAllowedPath(many, outside); });
});
