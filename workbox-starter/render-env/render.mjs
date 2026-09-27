// Optional isolated Linux x64 browser environment; Studio itself stays dependency-free.
import { createReadStream, createWriteStream, existsSync, mkdirSync, chmodSync, renameSync, writeFileSync } from 'node:fs';
import { createBrotliDecompress } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import tar from 'tar-fs';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This optional environment is for Linux x64; other systems can use Studio with their installed Chrome.');
const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache');
const source = join(here, 'node_modules', '@sparticuz', 'chromium', 'bin');
const binary = join(cache, 'chromium');
mkdirSync(cache, { recursive: true });
if (!existsSync(binary)) {
  await pipeline(createReadStream(join(source, 'chromium.br')), createBrotliDecompress(), createWriteStream(`${binary}.tmp`));
  chmodSync(`${binary}.tmp`, 0o755);
  renameSync(`${binary}.tmp`, binary);
}
if (!existsSync(join(cache, 'libGLESv2.so'))) await pipeline(createReadStream(join(source, 'swiftshader.tar.br')), createBrotliDecompress(), tar.extract(cache, { chown: false }));
const env = { ...process.env, MYSTIC_STUDIO_CHROME: binary, PLAYWRIGHT_CORE: fileURLToPath(import.meta.resolve('playwright-core')) };
if (existsSync('/etc/fonts/fonts.conf')) env.FONTCONFIG_PATH = '/etc/fonts';
const assetCache = join(cache, 'assets.json');
writeFileSync(assetCache, JSON.stringify({
  'https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js': join(here, 'node_modules/gsap/dist/gsap.min.js'),
  'https://unpkg.com/lenis@1.3.26/dist/lenis.min.js': join(here, 'node_modules/lenis/dist/lenis.min.js'),
}));
env.MYSTIC_STUDIO_ASSET_CACHE = assetCache;
const child = spawn(process.execPath, [join(here, '..', 'render-demo.mjs'), ...process.argv.slice(2)], { env, stdio: 'inherit' });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
