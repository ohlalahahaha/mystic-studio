'use strict';
// Offline smoke test: config resolution, prompts, tool list, MCP handshake,
// doctor runs, CLI dispatches an error cleanly. No network, no keys needed.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');

// 1. config loads with defaults, no keys required
const cfg = require(path.join(ROOT, 'lib', 'config'));
const c = cfg.load();
assert(c.outDir && c.stateDir, 'out/state dirs resolve');
assert.strictEqual(c.allowFileUrls, false, 'file:// blocked by default');
assert.strictEqual(c.host, '127.0.0.1', 'HTTP binds localhost by default');
assert(c.geminiKey === '' || typeof c.geminiKey === 'string', 'gemini key is a string (may be empty)');
assert(!/sk-|AIza/.test(JSON.stringify(c)), 'no raw secret shape in config dump');

// allowlist maths
assert(cfg.isAllowedPath(c, path.join(os.tmpdir(), 'x.png')) === true, 'tmp allowed');
assert(cfg.isAllowedPath(c, '/etc/passwd') === false, 'system paths blocked');

// 2. prompts exist and are de-personalized (no estate names)
const prompts = require(path.join(ROOT, 'lib', 'prompts'));
for (const k of ['PHOTO_LAW', 'DESIGN_LAW', 'VIDEO_LAW', 'DELTA_LAW']) assert(prompts[k].length > 200, `${k} present`);
for (const key of Object.keys(prompts)) assert(!/Phoenix|estate|hq\//i.test(prompts[key]), `${key} has no estate wording`);

// 3. tool list: 11 tools, schema'd, neutral
const { TOOLS } = require(path.join(ROOT, 'lib', 'core'));
assert.strictEqual(TOOLS.length, 11, '11 tools');
for (const t of TOOLS) { assert(t.name && t.description && t.inputSchema, `${t.name} complete`); assert(!/Phoenix/i.test(t.description)); }
const names = TOOLS.map((t) => t.name);
for (const want of ['photo_see', 'web_review', 'recheck', 'studio_doctor', 'video_gif', 'photo_generate']) assert(names.includes(want), `${want} present`);
assert(names.some((n) => /generate|edit/.test(n) && TOOLS.find((t) => t.name === n).description.includes('CREDITS')), 'paid tools labelled');

// 4. MCP handshake over stdio
const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n' +
  JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n' +
  JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n';
const hs = spawnSync(process.execPath, [path.join(ROOT, 'server.js')], { input: init, encoding: 'utf8', timeout: 20000 });
const lines = hs.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
assert(lines.find((m) => m.id === 1 && m.result && m.result.serverInfo), 'initialize answered');
const toolsMsg = lines.find((m) => m.id === 2);
assert(toolsMsg.result.tools.length === 11, 'tools/list answered with 11');

// 5. unknown tool -> clean MCP error
const bad = spawnSync(process.execPath, [path.join(ROOT, 'server.js')], {
  input: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope', arguments: {} } }) + '\n',
  encoding: 'utf8', timeout: 20000,
});
assert(/unknown tool/.test(bad.stdout), 'unknown tool errors cleanly');

// 6. doctor runs offline (may report MISSING — must not crash)
fs.writeFileSync(path.join(HERE, 'args-empty.json'), '{}');
const doc2 = spawnSync(process.execPath, [path.join(ROOT, 'run.js'), 'studio_doctor', path.join(HERE, 'args-empty.json')], { encoding: 'utf8', timeout: 30000 });
const parsed = JSON.parse(doc2.stdout.trim());
assert(parsed.ok && /MISSING |OK/.test(parsed.text), `doctor prints a report (${parsed.error || ''})`);

// 7. shot guard: file:// refused by default
fs.writeFileSync(path.join(HERE, 'args-shot.json'), JSON.stringify({ url: 'file:///etc/passwd', widths: [1280] }));
const shot = spawnSync(process.execPath, [path.join(ROOT, 'run.js'), 'web_shot', path.join(HERE, 'args-shot.json')], { encoding: 'utf8', timeout: 30000 });
assert(/only http/.test(JSON.parse(shot.stdout.trim()).error), 'file:// guard active');

for (const f of ['args-empty.json', 'args-shot.json']) try { fs.unlinkSync(path.join(HERE, f)); } catch {}
console.log('smoke: all checks passed');
