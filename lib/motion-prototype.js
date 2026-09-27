'use strict';
// A bounded, original website section export. External motion libraries stay optional
// in the exported project; the static composition renders without network or JS.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assets = require('./motion-assets');

function copy(value, field, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${field} must be non-empty text under ${max} characters`);
  return value.trim();
}
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function prototype(c, a) {
  const headline = copy(a.headline, 'headline', 100);
  const description = copy(a.description, 'description', 420);
  const action = copy(a.action, 'action', 44);
  const destination = copy(a.destination, 'destination', 350);
  if (destination !== '#details' && !/^(https:\/\/[^\s<>"']+|mailto:[^\s<>"']+)$/.test(destination)) throw new Error('destination must be an HTTPS or mailto URL, or #details');
  const selected = assets.select(a.motion);
  if (selected.some((item) => !['gsap', 'lenis'].includes(item.id))) throw new Error('HTML prototype supports gsap and lenis; Vanta needs a WebGL project and React Bits needs a React project. See motion_assets.');
  const ids = selected.map((item) => item.id);
  const data = JSON.stringify({ headline, description, action, destination, motion: ids });
  const id = crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
  const out = path.join(c.outDir, `motion-prototype-${id}.html`);
  const optionalScripts = [
    ...(ids.includes('gsap') ? ['<script defer src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>'] : []),
    ...(ids.includes('lenis') ? ['<script defer src="https://unpkg.com/lenis@1.3.26/dist/lenis.min.js"></script>'] : []),
  ].join('\n');
  const runtime = ids.length ? `<script>
window.addEventListener('load', () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  ${ids.includes('lenis') ? "if (window.Lenis) { const lenis = new Lenis({autoRaf:true}); window.addEventListener('pagehide', () => lenis.destroy(), {once:true}); }" : ''}
  ${ids.includes('gsap') ? "if (window.gsap) { gsap.fromTo('.art', {rotation:-8, scale:.96}, {rotation:0, scale:1, duration:.3, ease:'power2.out'}); }" : ''}
});
</script>` : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(headline)} · Mystic Studio prototype</title>
<style>
:root{--ink:#071d25;--sea:#103b42;--cream:#f2e9d9;--mint:#94d9c7;--clay:#dc8867}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--ink);color:var(--cream);font:17px/1.55 Arial,sans-serif}
main{max-width:1440px;margin:auto;min-height:100svh;padding:clamp(24px,5vw,76px);display:flex;flex-direction:column;background:radial-gradient(circle at 78% 45%,var(--sea),var(--ink) 55%)}
header,footer{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--mint)}header{display:flex;justify-content:space-between;gap:20px}header a{color:inherit}
.hero{flex:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(24px,5vw,80px);align-items:center}.copy{max-width:600px}.eyebrow{color:var(--mint);font-size:12px;letter-spacing:.16em;text-transform:uppercase}
h1{font:normal clamp(42px,5.4vw,78px)/1.05 Georgia,serif;letter-spacing:-.045em;margin:24px 0;overflow-wrap:anywhere}p{max-width:480px;color:#d6e1de;margin:0 0 32px}
.action{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 24px;background:var(--clay);color:var(--ink);font-weight:700;text-decoration:none;border-radius:2px}.action:focus-visible,header a:focus-visible{outline:3px solid var(--mint);outline-offset:4px}
.stage{min-height:400px;display:grid;place-items:center;position:relative;isolation:isolate}.stage:before{content:"";position:absolute;z-index:-1;width:min(100%,500px);aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,#24646a,#0d313a 57%,transparent 72%)}
.art{width:min(63%,280px);aspect-ratio:4/5;border-radius:48% 44% 38% 42%/40% 45% 50% 54%;transform:rotate(0);background:radial-gradient(ellipse at 33% 24%,#e8d3be,#a08d80 53%,#465053 86%);box-shadow:36px 42px 65px #010c1077,inset -25px -30px 40px #554f49aa}
footer{padding-top:30px}.detail{max-width:1440px;margin:auto;padding:50px clamp(24px,5vw,76px) 80px;border-top:1px solid #94d9c755;min-height:180px}.detail h2{font:normal 28px/1.2 Georgia,serif;margin:0 0 12px}.detail p{margin:0}
@media(max-width:700px){.hero{grid-template-columns:1fr;gap:14px;padding:48px 0}.stage{order:-1;min-height:265px}.art{width:170px}.detail{min-height:0}header span{display:none}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto!important}*,*:before,*:after{animation:none!important;transition:none!important}}
</style>${optionalScripts}</head><body><main><header><strong>Visual / production</strong><span>Original Studio prototype</span></header>
<div class="hero"><section class="copy"><div class="eyebrow">An original composition</div><h1>${escapeHtml(headline)}</h1><p>${escapeHtml(description)}</p><a class="action" href="${escapeHtml(destination)}">${escapeHtml(action)}</a></section><div class="stage" role="img" aria-label="Abstract sculptural form"><div class="art"></div></div></div>
<footer>Prototype · replace source and verify against approved references</footer></main><section class="detail" id="details"><h2>Designed for a real brief.</h2><p>Review this composition at desktop and mobile sizes before adapting it to the approved source material.</p></section>${runtime}</body></html>\n`;
  fs.mkdirSync(c.outDir, { recursive: true });
  fs.writeFileSync(out, html);
  return `saved ${out}\nmotion: ${ids.join(', ') || 'static'}\nPrototype only — no customer assets or reference fidelity claimed. Render and review before delivery.`;
}
module.exports = { prototype };
