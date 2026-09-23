'use strict';
// The engine. One dispatch() shared by every surface: MCP stdio (server.js),
// HTTP jobs (http.js), one-shot runner (run.js), CLI (cli.js).

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('./config');
const LAW = require('./prompts');

const SHOT = path.join(__dirname, '..', 'shot.js');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4' };
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

function sh(cmd, args, timeoutMs) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs || 30000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${cmd} failed: ${r.error.message}`);
  return r;
}

function slug(s) {
  const base = (() => { try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return path.basename(String(s).split('?')[0]); } })();
  return (base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'job').slice(0, 28);
}

function stamp() { return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); }

// ---------- sessions (the memory behind recheck) ----------
function sessionsDir(c) { return path.join(c.stateDir, 'sessions'); }

function saveSession(c, kind, target, verdict, extra) {
  const id = `${stamp()}-${slug(target)}`;
  const dir = path.join(sessionsDir(c), id);
  fs.mkdirSync(dir, { recursive: true });
  const meta = { id, kind, target, created: new Date().toISOString(), ...extra, verdicts: [{ at: new Date().toISOString(), verdict }] };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'verdict.md'), verdict);
  return id;
}

function appendSession(c, id, verdict) {
  const dir = path.join(sessionsDir(c), id);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  meta.verdicts.push({ at: new Date().toISOString(), verdict });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'verdict.md'), verdict);
  return meta;
}

function latestSession(c, kind) {
  const dirs = fs.readdirSync(sessionsDir(c)).filter((d) => {
    try { const m = JSON.parse(fs.readFileSync(path.join(sessionsDir(c), d, 'meta.json'), 'utf8')); return !kind || m.kind === kind; } catch { return false; }
  }).sort();
  return dirs[dirs.length - 1] || null;
}

// ---------- media loading ----------
function loadImage(c, src) {
  if (/^https?:\/\//.test(src)) {
    const tmp = path.join(os.tmpdir(), `studio-${stamp()}-${Math.random().toString(36).slice(2, 7)}${path.extname(src.split('?')[0]) || '.png'}`);
    sh('curl', ['-sL', '-m', '120', '-o', tmp, src], 130000);
    const sz = fs.statSync(tmp).size;
    if (sz > c.maxImageMb * 1024 * 1024) { fs.unlinkSync(tmp); throw new Error(`image over ${c.maxImageMb}MB limit (${(sz / 1048576).toFixed(1)}MB)`); }
    return { file: tmp, temp: true };
  }
  const p = path.resolve(src.startsWith('~') ? path.join(os.homedir(), src.slice(1)) : src);
  if (!fs.existsSync(p)) throw new Error(`image not found: ${p}`);
  if (!cfg.isAllowedPath(c, p)) throw new Error(`path outside allowed read dirs (${p}). Add the folder under "allowDirs" in mystic-studio.config.json — see README security section.`);
  const sz = fs.statSync(p).size;
  if (sz > c.maxImageMb * 1024 * 1024) throw new Error(`image over ${c.maxImageMb}MB limit — resize or raise maxImageMb`);
  return { file: p, temp: false };
}

function prepVideo(c, src) {
  let file;
  if (/^https?:\/\//.test(src)) {
    file = path.join(os.tmpdir(), `studio-${stamp()}-${Math.random().toString(36).slice(2, 7)}.mp4`);
    sh('curl', ['-sL', '-m', '600', '-o', file, src], 610000);
  } else {
    file = path.resolve(src.startsWith('~') ? path.join(os.homedir(), src.slice(1)) : src);
    if (!fs.existsSync(file)) throw new Error(`video not found: ${file}`);
    if (!cfg.isAllowedPath(c, file)) throw new Error(`path outside allowed read dirs (${file}). Add the folder under "allowDirs" in mystic-studio.config.json.`);
  }
  let out = { file, temp: /^https?:/.test(src) };
  if (!c.ffprobe) throw new Error('ffprobe not found on PATH — install ffmpeg (brew install ffmpeg). Doctor: mystic-studio doctor');
  const probe = JSON.parse(sh(c.ffprobe, ['-v', 'quiet', '-print_format', 'json', '-show_format', file]).stdout || '{}');
  const mb = (Number(probe.format && probe.format.size) || fs.statSync(file).size) / 1048576;
  if (mb > c.maxVideoMb) {
    if (!c.ffmpeg) throw new Error(`video is ${mb.toFixed(1)}MB (over ${c.maxVideoMb}MB) and ffmpeg is not on PATH to downscale it`);
    const small = path.join(os.tmpdir(), `studio-small-${stamp()}.mp4`);
    sh(c.ffmpeg, ['-y', '-i', file, '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libx264', '-preset', 'fast', '-crf', '30', '-c:a', 'aac', '-b:a', '96k', small], 600000);
    out = { file: small, temp: true };
  }
  return out;
}

// ---------- gemini vision ----------
function geminiSee(c, prompt, file, opts = {}) {
  if (!c.geminiKey) throw new Error('no GEMINI_API_KEY — put it in ~/.config/mystic-studio/.env (copy .env.example) or export it');
  const files = Array.isArray(file) ? file : [file];
  const content = [{ type: 'text', text: prompt }];
  for (const f of files) content.push({ type: 'image_url', image_url: { url: `data:${mimeOf(f)};base64,${fs.readFileSync(f).toString('base64')}` } });
  const body = {
    model: opts.deep ? c.proModel : c.flashModel,
    messages: [{ role: 'user', content }],
    max_tokens: opts.maxTokens || 1800,
    temperature: 0.2,
  };
  const bodyFile = path.join(os.tmpdir(), `studio-body-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(bodyFile, JSON.stringify(body));
  try {
    const r = sh('curl', ['-s', '-m', String(opts.timeoutS || 240), '-H', `Authorization: Bearer ${c.geminiKey}`, '-H', 'Content-Type: application/json', '--data-binary', `@${bodyFile}`, `${c.geminiBase}/chat/completions`], (opts.timeoutS || 240) * 1000 + 5000);
    let j;
    try { j = JSON.parse(r.stdout); } catch { throw new Error(`gemini non-JSON reply: ${(r.stdout || r.stderr || 'empty').slice(0, 300)}`); }
    if (j.error) throw new Error(`gemini error: ${j.error.message || JSON.stringify(j.error).slice(0, 300)}`);
    const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!text) throw new Error(`gemini empty reply: ${JSON.stringify(j).slice(0, 300)}`);
    return text;
  } finally { try { fs.unlinkSync(bodyFile); } catch {} }
}

// ---------- screenshots ----------
function webShot(c, url, out, opts = {}) {
  if (!/^https?:\/\//.test(url)) {
    if (c.allowFileUrls && /^file:\/\//.test(url)) { /* explicitly allowed by config */ }
    else if (!c.allowFileUrls) throw new Error('only http(s) URLs are shot by default (file:// can read local files). To allow it, set "allowFileUrls": true in your config.');
    else throw new Error(`cannot shoot URL: ${url}`);
  }
  const args = [url, out];
  if (opts.width) args.push('--w', String(opts.width));
  if (opts.height) args.push('--h', String(opts.height));
  if (opts.full) args.push('--full');
  const r = sh(process.execPath, [SHOT, ...args], 90000);
  if (r.status !== 0) throw new Error(`screenshot failed: ${(r.stderr || r.stdout || 'unknown').trim().slice(0, 400)}`);
  return out;
}

// ---------- higgsfield (paid generations) ----------
function higgs(c, args) {
  const cli = cfg.firstOnPath(c.higgsfieldCli);
  if (!cli) throw new Error(`higgsfield CLI not found (looked for "${c.higgsfieldCli}" on PATH) — install it or set "higgsfieldCli" in config. Analysis tools work without it.`);
  const r = sh(cli, args, 600000);
  const out = (r.stdout || '').trim();
  if (r.status !== 0) throw new Error(`higgsfield failed (${(r.stderr || '').trim().slice(0, 300) || 'exit ' + r.status})`);
  return out || '(no output)';
}

// ---------- video tools ----------
function videoKeyframes(c, src, count) {
  if (!c.ffmpeg || !c.ffprobe) throw new Error('ffmpeg/ffprobe not on PATH — brew install ffmpeg');
  const n = Math.min(Math.max(Number(count) || 8, 1), 20);
  const v = prepVideo(c, src);
  try {
    const dur = Number(JSON.parse(sh(c.ffprobe, ['-v', 'quiet', '-print_format', 'json', '-show_format', v.file]).stdout).format.duration) || 0;
    const tag = slug(src);
    const outs = [];
    for (let i = 0; i < n; i++) {
      const t = dur ? (dur * (i + 0.5)) / n : i;
      const out = path.join(c.outDir, `${tag}-frame-${String(i + 1).padStart(2, '0')}.jpg`);
      sh(c.ffmpeg, ['-y', '-ss', String(t), '-i', v.file, '-frames:v', '1', '-q:v', '3', out], 120000);
      outs.push(out);
    }
    return `saved ${n} keyframes:\n${outs.join('\n')}`;
  } finally { if (v.temp) try { fs.unlinkSync(v.file); } catch {} }
}

function videoGif(c, src, { start, seconds, width }) {
  if (!c.ffmpeg) throw new Error('ffmpeg not on PATH — brew install ffmpeg');
  const v = prepVideo(c, src);
  const s = Number(start) || 0, d = Math.min(Number(seconds) || 5, 30), w = Math.min(Number(width) || 480, 960);
  const pal = path.join(os.tmpdir(), `studio-pal-${stamp()}.png`);
  const out = path.join(c.outDir, `${slug(src)}-${stamp()}.gif`);
  try {
    sh(c.ffmpeg, ['-y', '-ss', String(s), '-t', String(d), '-i', v.file, '-vf', `fps=12,scale=${w}:-1:flags=lanczos,palettegen`, pal], 300000);
    sh(c.ffmpeg, ['-y', '-ss', String(s), '-t', String(d), '-i', v.file, '-i', pal, '-lavfi', `fps=12,scale=${w}:-1:flags=lanczos[x];[x][1:v]paletteuse`, out], 300000);
    return `saved ${out} (${(fs.statSync(out).size / 1048576).toFixed(2)}MB)`;
  } finally { try { fs.unlinkSync(pal); } catch {} if (v.temp) try { fs.unlinkSync(v.file); } catch {} }
}

// ---------- taste memory + score ----------
function tasteFile(c) {
  try { return JSON.parse(fs.readFileSync(path.join(c.stateDir, 'taste.json'), 'utf8')); } catch { return { notes: {} }; }
}
function hostOf(target) { try { return new URL(target).hostname.replace(/^www\./, ''); } catch { return slug(target); } }
function tasteAdd(c, target, note) {
  const t = tasteFile(c);
  const h = hostOf(target);
  (t.notes[h] = t.notes[h] || []).push({ at: new Date().toISOString(), note });
  t.notes[h] = t.notes[h].slice(-20);
  fs.mkdirSync(c.stateDir, { recursive: true });
  fs.writeFileSync(path.join(c.stateDir, 'taste.json'), JSON.stringify(t, null, 2));
}
function tasteFor(c, target) {
  const list = tasteFile(c).notes[hostOf(target)] || [];
  return list.slice(-5).map((n) => `- ${n.note}`).join('\n');
}
function extractFixes(verdict) {
  const m = verdict.match(/\*?\*?TOP 3 FIXES:?\*?\*?\s*\n([\s\S]*?)(?=\n\s*(?:\*\*)?[A-Z][A-Z ]{3,}|\n---|$)/);
  return m ? m[1].trim() : '';
}
function parseScore(text) {
  const m = text.match(/SCORE:?\s*\*?\*?\s*(\d{1,3})\s*\/\s*100/i);
  return m ? Math.min(100, Number(m[1])) : null;
}
const scoreLine = (v) => { const s = parseScore(v); return s === null ? '' : `\nscore: ${s}/100`; };

// ---------- doctor ----------
function doctor(c) {
  const rows = [];
  const ok = (name, good, note) => rows.push(`${good ? 'OK      ' : 'MISSING '} ${name.padEnd(18)} ${note}`);
  ok('node', true, process.version);
  ok('gemini key', !!c.geminiKey, c.geminiKey ? 'set' : `put GEMINI_API_KEY in ${c.envFile || '~/.config/mystic-studio/.env'} (copy .env.example)`);
  ok('curl', !!cfg.firstOnPath('curl'), 'any vision call needs it');
  ok('ffmpeg', !!c.ffmpeg, c.ffmpeg || 'video tools need it — brew install ffmpeg');
  ok('ffprobe', !!c.ffprobe, c.ffprobe || 'video analysis needs it');
  try {
    const r = sh(process.execPath, [SHOT, '--check'], 30000);
    for (const line of (r.stdout || '').trim().split('\n').filter(Boolean)) {
      const m = line.match(/^(playwright|browser)=(OK|MISSING)\s*(.*)$/);
      if (m) ok(m[1], m[2] === 'OK', m[3] || '');
    }
  } catch (e) { ok('playwright', false, e.message.slice(0, 120)); }
  const h = cfg.firstOnPath(c.higgsfieldCli);
  ok('higgsfield (optional)', !!h, h || `generate/edit tools need the higgsfield CLI — analysis works without it`);
  const runner = cfg.firstOnPath(c.codingRunner);
  ok(`coding runner (optional)`, !!runner, runner || `mystic-coding-room needs "${c.codingRunner}" on PATH (any command with the same interface works — see README)`);
  try { cfg.ensureDirs(c); ok('out dir writable', true, c.outDir); } catch (e) { ok('out dir writable', false, `${c.outDir}: ${e.message}`); }
  ok('config file', true, c.configFileUsed || 'none (defaults — copy config.example.json to customise)');
  return rows.join('\n');
}

// ---------- tools ----------
const S = { type: 'string' };
const TOOLS = [
  { name: 'photo_see', description: 'Photography eye: critique or analyse any image (local path or https URL). Composition, light, colour, defects, print-readiness. deep=true for the pro model. Returns a session id for recheck.', inputSchema: { type: 'object', properties: { image: S, focus: { ...S, description: 'optional specific question' }, deep: { type: 'boolean' } }, required: ['image'] } },
  { name: 'photo_generate', description: 'Text → image via the configured higgsfield provider. SPENDS PREPAID CREDITS per image — call only when the user explicitly asked for generated media.', inputSchema: { type: 'object', properties: { prompt: S, aspect_ratio: { ...S, description: 'e.g. 16:9, 1:1 (default)' }, model: { ...S, description: 'optional specific model' } }, required: ['prompt'] } },
  { name: 'photo_edit', description: 'Image + instruction → edited image via higgsfield. SPENDS PREPAID CREDITS. Pass a local path; output lands in the out dir.', inputSchema: { type: 'object', properties: { image: S, instruction: S }, required: ['image', 'instruction'] } },
  { name: 'studio_catalog', description: 'List available higgsfield image models (kind: t2i default, also i2i etc).', inputSchema: { type: 'object', properties: { kind: S } } },
  { name: 'web_shot', description: 'Screenshot a URL (default desktop 1280 + mobile 390). Returns saved PNG paths.', inputSchema: { type: 'object', properties: { url: S, widths: { type: 'array', items: { type: 'number' } }, full_page: { type: 'boolean' } }, required: ['url'] } },
  { name: 'web_review', description: 'Web-design review: screenshots the URL at desktop + mobile, then critiques hierarchy/spacing/type/colour/mobile with top-3 fixes and a SHIP verdict. deep=true for the pro model. Returns a session id for recheck.', inputSchema: { type: 'object', properties: { url: S, brief: { ...S, description: 'optional business context' }, deep: { type: 'boolean' } }, required: ['url'] } },
  { name: 'recheck', description: 'Re-review after fixes: compares a fresh capture against a previous review/see session and reports what changed and which top fixes landed. Pass the session id (omit for the latest).', inputSchema: { type: 'object', properties: { session: S, url: S, image: S, brief: S, deep: { type: 'boolean' } } } },
  { name: 'video_see', description: 'Video intelligence: scene summary, timestamped timeline, word-for-word speech transcription, quality verdict. Local path or https URL (large files auto-downscaled). deep=true for the pro model. Returns a session id.', inputSchema: { type: 'object', properties: { video: S, focus: S, deep: { type: 'boolean' } }, required: ['video'] } },
  { name: 'video_keyframes', description: 'Pull N evenly-spaced keyframes from a video as JPGs (default 8, max 20).', inputSchema: { type: 'object', properties: { video: S, count: { type: 'number' } }, required: ['video'] } },
  { name: 'video_gif', description: 'Turn a span of a video into an optimized two-pass-palette GIF (default first 5s, 480px).', inputSchema: { type: 'object', properties: { video: S, start: { type: 'number' }, seconds: { type: 'number' }, width: { type: 'number' } }, required: ['video'] } },
  { name: 'studio_doctor', description: 'Check every dependency (gemini key, curl, ffmpeg, playwright, browser, optional CLIs) and print how to fix what is missing.', inputSchema: { type: 'object', properties: {} } },
  { name: 'web_audit', description: 'Whole-site audit: crawls same-host pages (default 8), screenshots each, returns per-page verdicts, a site SCORE /100, and cross-page consistency findings.', inputSchema: { type: 'object', properties: { url: S, max_pages: { type: 'number' } }, required: ['url'] } },
  { name: 'polish', description: 'Autonomous improvement loop: reviews the URL, applies the top fixes to the repo via the configured coding runner, delta-rechecks, repeats until SHIP or round/budget cap. The runner edits real code with your permissions — read SECURITY.md first.', inputSchema: { type: 'object', properties: { url: S, repo: { ...S, description: 'local checkout of the site being served at url' }, brief: S, max_rounds: { type: 'number' }, profile: S, deep: { type: 'boolean' } }, required: ['url', 'repo'] } },
  { name: 'taste_note', description: 'Teach the reviewer: add a taste note it will remember for this site. Reviews also record their top fixes here automatically, so verdicts sharpen round over round.', inputSchema: { type: 'object', properties: { target: S, note: S }, required: ['target', 'note'] } },
];

// ---------- dispatch ----------
function dispatch(name, a) {
  const c = cfg.load();
  cfg.ensureDirs(c);
  switch (name) {
    case 'studio_doctor':
      return doctor(c);

    case 'photo_see': {
      const img = loadImage(c, a.image);
      try {
        const law = LAW.PHOTO_LAW + (a.focus ? `\n\nFOCUS: ${a.focus}` : '');
        const verdict = geminiSee(c, law, img.file, { deep: a.deep });
        const id = saveSession(c, 'photo_see', a.image, verdict, { score: parseScore(verdict) });
        return `${verdict}${scoreLine(verdict)}\n\nsession: ${id} — after fixes, recheck with: recheck {"session":"${id}","image":"..."}`;
      } finally { if (img.temp) try { fs.unlinkSync(img.file); } catch {} }
    }

    case 'photo_generate': {
      const args = ['image', a.prompt];
      if (a.aspect_ratio) args.push('--ar', a.aspect_ratio);
      if (a.model) args.push('-m', a.model);
      return higgs(c, args);
    }

    case 'photo_edit': {
      const img = loadImage(c, a.image);
      return higgs(c, ['edit', img.file, '-p', a.instruction]);
    }

    case 'studio_catalog':
      return higgs(c, ['models', a.kind || 't2i']);

    case 'web_shot': {
      const widths = (a.widths && a.widths.length ? a.widths : [1280, 390]);
      const tag = `${slug(a.url)}-${stamp()}`;
      const outs = widths.map((w) => webShot(c, a.url, path.join(c.outDir, `${tag}-${w}.png`), { width: w, full: a.full_page }));
      return `saved:\n${outs.join('\n')}`;
    }

    case 'web_review': {
      const tag = `${slug(a.url)}-${stamp()}`;
      const desk = path.join(c.outDir, `${tag}-1280.png`);
      const mob = path.join(c.outDir, `${tag}-390.png`);
      webShot(c, a.url, desk, { width: 1280 });
      webShot(c, a.url, mob, { width: 390 });
      const taste = tasteFor(c, a.url);
      const law = LAW.DESIGN_LAW + (taste ? `\n\nTASTE MEMORY for this site (learned from earlier rounds — respect it and check whether it is respected):\n${taste}` : '') + (a.brief ? `\n\nBUSINESS CONTEXT: ${a.brief}` : '');
      const verdict = geminiSee(c, law, desk, { deep: a.deep });
      const mobVerdict = geminiSee(c, 'Same review standards, mobile screenshot only. MOBILE section only — specific mobile problems (overflow, tap targets, reflow, text size) or "clean".', mob, { deep: a.deep, maxTokens: 700 });
      const full = `${verdict}\n\n--- MOBILE ---\n${mobVerdict}`;
      const fixes = extractFixes(verdict);
      if (fixes) tasteAdd(c, a.url, fixes);
      const id = saveSession(c, 'web_review', a.url, full, { shots: [desk, mob], score: parseScore(verdict) });
      return `${full}\n\nshots: ${desk} | ${mob}${scoreLine(verdict)}\nsession: ${id} — after fixes, recheck with: recheck {"session":"${id}"}`;
    }

    case 'recheck': {
      const id = a.session || latestSession(c, 'web_review') || latestSession(c, 'photo_see');
      if (!id) throw new Error('no sessions yet — run web_review or photo_see first');
      const meta = JSON.parse(fs.readFileSync(path.join(sessionsDir(c), id, 'meta.json'), 'utf8'));
      const prev = meta.verdicts[meta.verdicts.length - 1].verdict;
      const deltaLaw = LAW.DELTA_LAW + prev + '\n--- END PREVIOUS ---';
      let verdict;
      if (meta.kind === 'web_review' || a.url) {
        const url = a.url || meta.target;
        const tag = `${slug(url)}-${stamp()}`;
        const desk = path.join(c.outDir, `${tag}-1280.png`);
        webShot(c, url, desk, { width: 1280 });
        verdict = geminiSee(c, deltaLaw + (a.brief ? `\n\nBUSINESS CONTEXT: ${a.brief}` : ''), desk, { deep: a.deep });
      } else if (a.image || meta.kind === 'photo_see') {
        const img = loadImage(c, a.image || meta.target);
        try { verdict = geminiSee(c, deltaLaw + (a.focus ? `\n\nFOCUS: ${a.focus}` : ''), img.file, { deep: a.deep }); } finally { if (img.temp) try { fs.unlinkSync(img.file); } catch {} }
      } else throw new Error(`recheck supports web_review and photo_see sessions (this one is ${meta.kind})`);
      appendSession(c, id, verdict);
      return `RECHECK of ${id}\n\n${verdict}\n\nsession: ${id} (history: ${meta.verdicts.length} reviews)`;
    }

    case 'web_audit': {
      const { audit } = require('./audit');
      return audit(c, a, {
        shoot: (u, out) => webShot(c, u, out, { width: 1280 }),
        geminiMulti: (prompt, files, opts) => geminiSee(c, prompt, files, opts),
        saveSession: (kind, target, v, extra) => saveSession(c, kind, target, v, { ...extra, score: parseScore(v) }),
        outDir: c.outDir,
      });
    }

    case 'polish': {
      const { polish } = require('./polish');
      return polish(c, { ...a, maxRounds: a.max_rounds, profile: a.profile || 'fast' }, {
        review: (url, brief) => dispatch('web_review', { url, brief, deep: a.deep }),
        delta: (url) => dispatch('recheck', { url }),
        runContract: (repo, profile, contract) => {
          const runner = cfg.firstOnPath(c.codingRunner);
          if (!runner) throw new Error(`coding runner "${c.codingRunner}" not on PATH — polish needs one (see README)`);
          const r = sh(runner, ['--repo', repo, '--mode', profile, `--${profile}`, contract], 30 * 60 * 1000);
          const out = `${r.stdout || ''}${r.stderr || ''}`;
          const line = out.split('\n').reverse().find((l) => /^\s*RESULT:/.test(l)) || '';
          return { verdict: line.replace(/^\s*RESULT:\s*/, '').trim() || 'NO VERDICT', output: out.slice(-4000) };
        },
        saveStep: (id, text) => { fs.appendFileSync(path.join(sessionsDir(c), id, 'polish.md'), `\n\n--- round ---\n${text}`); },
        newId: (target) => saveSession(c, 'polish', target, 'polish loop started', {}),
      });
    }

    case 'taste_note': {
      tasteAdd(c, a.target, a.note);
      const n = (tasteFile(c).notes[hostOf(a.target)] || []).length;
      return `noted for ${hostOf(a.target)} — ${n} taste note(s) on file`;
    }

    case 'video_see': {
      const v = prepVideo(c, a.video);
      try {
        const law = LAW.VIDEO_LAW + (a.focus ? `\n\nFOCUS: ${a.focus}` : '');
        const verdict = geminiSee(c, law, v.file, { deep: a.deep, timeoutS: 300 });
        const id = saveSession(c, 'video_see', a.video, verdict);
        return `${verdict}\n\nsession: ${id}`;
      } finally { if (v.temp) try { fs.unlinkSync(v.file); } catch {} }
    }

    case 'video_keyframes':
      return videoKeyframes(c, a.video, a.count);

    case 'video_gif':
      return videoGif(c, a.video, a);

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

module.exports = { dispatch, TOOLS, doctor, load: cfg.load, tasteFor, tasteFile, hostOf };
