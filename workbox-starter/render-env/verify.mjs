import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'output');
const html = readFileSync(join(here, '..', 'demo', 'motion.html'));
const assets = JSON.parse(readFileSync(join(here, '.cache', 'assets.json'), 'utf8'));
const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/motion`;
const browser = await chromium.launch({ executablePath: join(here, '.cache', 'chromium'), headless: true, env: { ...process.env, FONTCONFIG_PATH: '/etc/fonts' } });
mkdirSync(out, { recursive: true });
const results = [];
try {
  for (const mode of ['motion', 'reduced', 'offline']) for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 900 : 844 }, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
    const errors = [];
    const expectedOfflineFailures = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (mode === 'offline' && message.text().includes('net::ERR_FAILED')) expectedOfflineFailures.push(message.text());
      else errors.push(message.text());
    });
    for (const [source, file] of Object.entries(assets)) await page.route(source, (route) => mode === 'offline' ? route.abort() : route.fulfill({ path: file, contentType: 'application/javascript' }));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const facts = await page.evaluate(() => ({
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      headline: document.querySelector('h1').innerText,
      actionHeight: document.querySelector('.action').getBoundingClientRect().height,
      gsap: window.gsap?.version || null, lenis: typeof window.Lenis === 'function',
      smoothActive: document.documentElement.classList.contains('lenis'),
    }));
    assert(facts.documentWidth <= width, `${mode}/${width} overflows`);
    assert(facts.headline && facts.actionHeight >= 44, `${mode}/${width} content or CTA missing`);
    assert.deepEqual(errors, [], `${mode}/${width} runtime errors`);
    if (mode !== 'offline') assert(facts.gsap === '3.15.0' && facts.lenis, 'pinned libraries must load');
    else assert(!facts.gsap && !facts.lenis, 'offline fallback must not depend on libraries');
    assert.equal(facts.smoothActive, mode === 'motion', 'reduced/offline modes must retain native scroll');
    const screenshot = `motion-${mode}-${width}.png`;
    await page.screenshot({ path: join(out, screenshot), fullPage: true });
    await page.locator('.action').click();
    assert.equal(new URL(page.url()).hash, '#details', 'CTA must reach the details section');
    results.push({ mode, ...facts, errors, expectedOfflineFailures, cta: 'passed', screenshot });
    await page.close();
  }
  writeFileSync(join(out, 'motion-verification.json'), JSON.stringify({ sourceSha256: createHash('sha256').update(html).digest('hex'), librarySource: 'pinned npm cache; not a CDN reachability test', results }, null, 2));
  console.log(`motion browser verification: ${results.length} viewport/mode checks passed`);
} finally {
  await browser.close();
  server.close();
}
