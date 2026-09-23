'use strict';
// Same-host crawler + whole-site design audit. Pages are fetched with curl, shot
// at 1280w by the caller-provided shooter, and the batch is reviewed as one site
// under AUDIT_LAW. No fs access here — the caller owns the shot files.

const path = require('path');
const { spawnSync } = require('child_process');
const { AUDIT_LAW } = require('./prompts');

const SKIP_EXT = /\.(png|jpe?g|gif|webp|svg|pdf|zip|mp4|css|js|ico|woff2?|ttf|xml|json)$/i;

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
}

function fetchHtml(url) {
  const r = spawnSync('curl', ['-sL', '-m', '20', url], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return r.status === 0 && typeof r.stdout === 'string' ? r.stdout : '';
}

function crawl(startUrl, maxPages) {
  const cap = Math.min(Math.max(Number(maxPages) || 8, 1), 12);
  const start = new URL(startUrl);
  start.hash = '';
  const host = hostOf(start.href);
  const pages = [start.href];
  const seen = new Set(pages);
  const queue = [start.href];
  while (queue.length && pages.length < cap) {
    const current = queue.shift();
    const html = fetchHtml(current);
    const base = new URL(current);
    for (const m of html.matchAll(/href="([^"]*)"/g)) {
      let next;
      try { next = new URL(m[1], base); } catch { continue; }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') continue;
      next.hash = '';
      if (hostOf(next.href) !== host || SKIP_EXT.test(next.pathname) || seen.has(next.href)) continue;
      seen.add(next.href);
      pages.push(next.href);
      queue.push(next.href);
      if (pages.length >= cap) break;
    }
  }
  return pages;
}

function slug(url) {
  return hostOf(url).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28).replace(/-+$/, '');
}

function audit(c, a, api) {
  const found = crawl(a.url, a.maxPages);
  const host = slug(a.url);
  const shots = [];
  const dropped = [];
  found.forEach((url, i) => {
    const out = path.join(api.outDir, `${host}-audit-${i + 1}.png`);
    try { api.shoot(url, out); shots.push({ url, out }); }
    catch (e) { dropped.push(`${url} (${e.message})`); }
  });
  if (!shots.length) throw new Error(`all ${found.length} page shoot(s) failed — nothing to audit`);
  const pages = shots.map((s) => s.url);
  const prompt = AUDIT_LAW.replace('${N}', String(pages.length));
  const verdict = api.geminiMulti(prompt, shots.map((s) => s.out), { maxTokens: 3000 });
  const id = api.saveSession('web_audit', a.url, verdict, { pages });
  const lines = [
    verdict,
    '',
    `pages audited: ${pages.map((u) => new URL(u).pathname.replace(/\/$/, '') || '/').join(', ')}`,
  ];
  if (dropped.length) lines.push(`dropped (shoot failed): ${dropped.join('; ')}`);
  lines.push(`session: ${id}`);
  return lines.join('\n');
}

module.exports = { crawl, audit };
