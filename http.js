#!/usr/bin/env node
'use strict';
// HTTP job API — lets ChatGPT connectors, scripts and other agents use the studio
// without stdio. Forge-style async: POST /v1/call -> 202 {job_id} -> GET /v1/jobs/<id>.
// Binds 127.0.0.1 by default. If MYSTIC_STUDIO_TOKEN (or config "token") is set,
// every request must carry header  X-Studio-Key: <token>  (timing-safe compare).

const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('./lib/config');
const { TOOLS } = require('./lib/core');

const RUN = path.join(__dirname, 'run.js');
const c = cfg.load();
cfg.ensureDirs(c);
const jobsDir = path.join(c.stateDir, 'jobs');
const jobs = new Map();
for (const f of fs.readdirSync(jobsDir).filter((f) => f.endsWith('.json'))) {
  try { const j = JSON.parse(fs.readFileSync(path.join(jobsDir, f), 'utf8')); jobs.set(j.id, j); } catch {}
}

function persist(job) { fs.writeFileSync(path.join(jobsDir, `${job.id}.json`), JSON.stringify(job)); }
function authorized(req) {
  if (!c.token) return true;
  const got = String(req.headers['x-studio-key'] || '');
  const a = Buffer.from(got), b = Buffer.from(c.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function json(res, code, obj) { const s = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) }); res.end(s); }

function startJob(name, args) {
  const id = `j-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const job = { id, name, status: 'running', started: new Date().toISOString() };
  jobs.set(id, job); persist(job);
  const argsFile = path.join(jobsDir, `${id}.args.json`);
  fs.writeFileSync(argsFile, JSON.stringify(args || {}));
  const child = spawn(process.execPath, [RUN, name, argsFile], { encoding: 'utf8' });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const finish = (status, patch) => {
    job.status = status; job.finished = new Date().toISOString(); Object.assign(job, patch);
    try { fs.unlinkSync(argsFile); } catch {}
    persist(job);
    console.log(`[job] ${id} ${name} -> ${status}`);
  };
  child.on('close', () => {
    let r = null;
    try { r = JSON.parse(out.trim().split('\n').filter(Boolean).pop() || 'null'); } catch {}
    if (r && r.ok) finish('done', { result: r.text });
    else finish('error', { error: (r && r.error) || 'runner failed' });
  });
  child.on('error', (e) => finish('error', { error: e.message }));
  return job;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (!authorized(req)) return json(res, 401, { error: 'bad or missing X-Studio-Key header' });
  if (req.method === 'GET' && u.pathname === '/health') return json(res, 200, { ok: true, service: 'mystic-studio', token_required: !!c.token });
  if (req.method === 'GET' && u.pathname === '/v1/tools') return json(res, 200, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (req.method === 'POST' && u.pathname === '/v1/call') {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 10 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let a; try { a = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'body must be JSON {name, arguments}' }); }
      const { name, arguments: args } = a;
      if (!name || !TOOLS.some((t) => t.name === name)) return json(res, 400, { error: `unknown tool: ${name}`, tools: TOOLS.map((t) => t.name) });
      json(res, 202, { job_id: startJob(name, args).id, status: 'running' });
    });
    return;
  }
  const jm = u.pathname.match(/^\/v1\/jobs\/([\w-]+)$/);
  if (req.method === 'GET' && jm) {
    const job = jobs.get(jm[1]);
    if (!job) return json(res, 404, { error: 'no such job' });
    const { result, error, ...rest } = job;
    return json(res, 200, { ...rest, result, error });
  }
  json(res, 404, { error: 'routes: GET /health, GET /v1/tools, POST /v1/call, GET /v1/jobs/<id>' });
});

server.listen(c.port, c.host, () => {
  console.log(`mystic-studio HTTP API on http://${c.host}:${c.port} (token: ${c.token ? 'required' : 'NOT set — localhost only'})`);
  console.log(`POST /v1/call {"name":"web_review","arguments":{"url":"https://..."}} then poll GET /v1/jobs/<job_id>`);
});
