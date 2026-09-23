#!/usr/bin/env node
'use strict';
// mystic-coding-room — a bounded room where an external coding agent works on one
// repo under one written contract, with a verdict at the end.
//   mystic-coding-room --repo <dir> --fast|--full "contract text..."
// Guards: destructive-command preflight (ADVISORY — a filter, not a sandbox; the
// runner runs with your user's full permissions), one-writer lock, 25-min watchdog.
// The runner is any command with this interface (default: glm-run):
//   <runner> --repo <dir> --mode <fast|full> --<fast|full> <contract>
// and it must end its output with a line:  RESULT: SHIP | NEEDS ATTENTION — fix | NO-GO — why

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('./lib/config');

const ROOM = path.join(os.homedir(), '.mystic-studio', 'coding-room');
const LOCK = path.join(ROOM, 'lock');
const WATCHDOG_MS = 25 * 60 * 1000;
const STALE_MS = 45 * 60 * 1000;
const DESTRUCTIVE = /\bgit\s+(push\s.*(\s--force\b|\s-f\b|--force-with-lease)|reset\s.*--hard|clean\s.*-f|branch\s.*-D|checkout\s.*--\s|restore\s)|\brm\s+-rf\s+(~|\/|\$HOME)|\bsudo\s/;

function fail(msg, code) { console.error(`ERROR: ${msg}`); process.exit(code || 2); }

function usage() {
  console.log(`usage: mystic-coding-room --repo <dir> [--fast|--full] "contract..."
contract must state: what to build/fix, no-go lines, and "RESULT: SHIP | NEEDS ATTENTION — fix | NO-GO — why" at the end.
  --last        show the last verdict and exit`);
}

let held = false;
function acquireLock() {
  fs.mkdirSync(ROOM, { recursive: true });
  if (fs.existsSync(LOCK)) {
    try {
      const { pid, at } = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
      process.kill(pid, 0);
      if (Date.now() - at < STALE_MS) fail(`room is busy (pid ${pid}, started ${new Date(at).toLocaleTimeString()}). If that is wrong, delete ${LOCK}`);
    } catch { /* stale or gone — take it */ }
  }
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }));
  held = true;
}
function releaseLock() { if (!held) return; try { fs.unlinkSync(LOCK); } catch {} held = false; }

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--last') {
    try { console.log(fs.readFileSync(path.join(ROOM, 'last-result'), 'utf8')); } catch { console.log('no runs yet'); }
    return;
  }
  const get = (k) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : null; };
  const repo = get('--repo');
  const profile = argv.includes('--full') ? 'full' : 'fast';
  const briefParts = [];
  for (let i = 0; i < argv.length; i++) {
    if (['--repo'].includes(argv[i])) { i++; continue; }
    if (argv[i] === '--fast' || argv[i] === '--full') continue;
    briefParts.push(argv[i]);
  }
  const contract = briefParts.join(' ').trim();
  if (!repo || !contract) { usage(); process.exit(2); }
  if (!fs.existsSync(path.join(repo, '.git'))) fail(`not a git repo: ${repo}`);
  if (DESTRUCTIVE.test(contract)) fail(`contract mentions destructive git operations (advisory preflight). Rewrite it as outcomes, not commands.`);

  acquireLock();
  const runner = cfg.load().codingRunner || 'glm-run';
  const runnerPath = spawnSync('which', [runner], { encoding: 'utf8' }).stdout.trim();
  if (!runnerPath) { releaseLock(); fail(`runner "${runner}" not on PATH — install one or set "codingRunner" in config (interface: <runner> --repo <dir> --mode <mode> --<mode> <contract>)`); }

  console.log(`room open: ${repo} (${profile}, watchdog 25 min)`);
  const started = Date.now();
  const r = spawnSync(runnerPath, ['--repo', repo, '--mode', profile, `--${profile}`, contract], {
    encoding: 'utf8', timeout: WATCHDOG_MS, maxBuffer: 64 * 1024 * 1024, cwd: repo,
    env: { ...process.env, CODING_ROOM: '1', CODING_ROOM_REPO: repo },
  });
  releaseLock();

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  process.stdout.write(out);
  const verdictLine = out.split('\n').reverse().find((l) => /^\s*RESULT:/.test(l)) || '';
  const verdict = verdictLine.replace(/^\s*RESULT:\s*/, '').trim() || `NO VERDICT (exit ${r.status}${r.signal ? ', ' + r.signal : ''}, ${mins} min)`;
  const rc = /SHIP/i.test(verdict) && !/NO[- ]?SHIP/i.test(verdict) ? 0 : /NEEDS ATTENTION/i.test(verdict) ? 3 : /NO-GO/i.test(verdict) ? 4 : 99;
  fs.mkdirSync(ROOM, { recursive: true });
  fs.writeFileSync(path.join(ROOM, 'last-result'), `${new Date().toISOString()}  ${repo}  (${profile}, ${mins} min)\nRESULT: ${verdict}\n`);
  console.log(`\nroom closed after ${mins} min — RESULT: ${verdict}`);
  process.exit(rc);
}
try { main(); } catch (e) { releaseLock(); fail(e.message, 1); }
process.on('exit', () => releaseLock());
