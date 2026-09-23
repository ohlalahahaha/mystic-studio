'use strict';
// Resolution order: process env > config file (./mystic-studio.config.json, then
// ~/.config/mystic-studio/config.json) > auto-detected defaults. Nothing is pinned:
// binaries resolve from PATH, playwright-core and the browser are discovered at runtime.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULTS = {
  geminiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
  flashModel: 'gemini-3.8-flash',
  proModel: 'gemini-3.1-pro-preview',
  outDir: path.join(os.homedir(), 'Desktop', 'mystic-studio'),
  stateDir: path.join(os.homedir(), '.mystic-studio'),
  port: 7817,
  host: '127.0.0.1',
  maxImageMb: 9,
  maxVideoMb: 19,
  allowFileUrls: false,
  allowDirs: [],
  browserExe: '',
  playwrightCore: '',
  higgsfieldCli: 'higgsfield',
  codingRunner: 'glm-run',
  token: '',
  envFile: '',
};

let _cache = null;

function configFile() {
  const cands = [
    process.env.MYSTIC_STUDIO_CONFIG,
    path.join(process.cwd(), 'mystic-studio.config.json'),
    path.join(os.homedir(), '.config', 'mystic-studio', 'config.json'),
  ].filter(Boolean);
  for (const p of cands) if (fs.existsSync(p)) return p;
  return null;
}

function readEnvFile(file) {
  // Parse NAME=value lines (export and quotes tolerated). Returns {} on any problem.
  const out = {};
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const m of txt.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\n]*?)"?\s*$/gm)) {
      if (!(m[1] in out)) out[m[1]] = m[2];
    }
  } catch {}
  return out;
}

function firstOnPath(name) {
  if (name.includes('/') && fs.existsSync(name)) return name;
  const tryPaths = [
    ...(name && !name.includes('/') ? [path.join(os.homedir(), 'bin', name)] : []),
  ];
  for (const p of tryPaths) if (fs.existsSync(p)) return p;
  try {
    const p = execFileSync('which', [name], { encoding: 'utf8' }).trim();
    return p || null;
  } catch { return null; }
}

function expandTilde(p) { return typeof p === 'string' && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p; }

function load() {
  if (_cache) return _cache;
  const c = { ...DEFAULTS };
  const used = configFile();
  if (used) {
    try {
      const raw = JSON.parse(fs.readFileSync(used, 'utf8'));
      for (const [k, v] of Object.entries(raw)) {
        if (k in DEFAULTS && v !== '' && v !== null && v !== undefined) c[k] = v;
      }
    } catch (e) { throw new Error(`config file is not valid JSON (${used}): ${e.message}`); }
  }
  c.configFileUsed = used;
  for (const k of ['outDir', 'stateDir', 'browserExe', 'playwrightCore', 'envFile', 'higgsfieldCli', 'codingRunner']) c[k] = expandTilde(c[k]);
  c.allowDirs = (Array.isArray(c.allowDirs) ? c.allowDirs : []).map(expandTilde);

  const env = { ...readEnvFile(c.envFile || path.join(os.homedir(), '.config', 'mystic-studio', '.env')), ...process.env };
  c.geminiKey = env.GEMINI_API_KEY || '';
  if (env.MYSTIC_STUDIO_TOKEN) c.token = env.MYSTIC_STUDIO_TOKEN;
  if (env.MYSTIC_STUDIO_OUT) c.outDir = expandTilde(env.MYSTIC_STUDIO_OUT);
  if (env.MYSTIC_STUDIO_PORT) c.port = Number(env.MYSTIC_STUDIO_PORT) || c.port;
  if (env.MYSTIC_STUDIO_HOST) c.host = env.MYSTIC_STUDIO_HOST;
  if (env.MYSTIC_STUDIO_FLASH) c.flashModel = env.MYSTIC_STUDIO_FLASH;
  if (env.MYSTIC_STUDIO_PRO) c.proModel = env.MYSTIC_STUDIO_PRO;
  if (env.MYSTIC_STUDIO_CHROME) c.browserExe = expandTilde(env.MYSTIC_STUDIO_CHROME);

  c.ffmpeg = process.env.MYSTIC_STUDIO_FFMPEG || firstOnPath('ffmpeg') || firstOnPath('/usr/local/bin/ffmpeg') || firstOnPath('/opt/homebrew/bin/ffmpeg') || '';
  c.ffprobe = process.env.MYSTIC_STUDIO_FFPROBE || firstOnPath('ffprobe') || firstOnPath('/usr/local/bin/ffprobe') || firstOnPath('/opt/homebrew/bin/ffprobe') || '';
  _cache = c;
  return c;
}

// Paths the studio may read media from: cwd, output dir, temp, plus config allowDirs.
function allowedReadDirs(c) {
  const set = new Set([process.cwd(), c.outDir, os.tmpdir(), ...c.allowDirs]);
  return [...set].map((p) => (p && path.resolve(p)));
}

function isAllowedPath(c, p) {
  const abs = path.resolve(expandTilde(p));
  return allowedReadDirs(c).some((dir) => abs === dir || abs.startsWith(dir + path.sep));
}

function ensureDirs(c) {
  fs.mkdirSync(c.outDir, { recursive: true });
  fs.mkdirSync(path.join(c.stateDir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(c.stateDir, 'jobs'), { recursive: true });
}

module.exports = { load, configFile, readEnvFile, firstOnPath, allowedReadDirs, isAllowedPath, ensureDirs, DEFAULTS };
