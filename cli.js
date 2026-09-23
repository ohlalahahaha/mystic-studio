#!/usr/bin/env node
'use strict';
// mystic-studio CLI. Thin: parses verbs/flags into a JSON args file and runs run.js.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RUN = path.join(__dirname, 'run.js');
const BOOL = new Set(['deep', 'full_page', 'full']);

function usage() {
  console.log(`mystic-studio — AI media studio (photography eye, web review, video, screenshots)

  mystic-studio doctor                         check every dependency, show fixes
  mystic-studio see <image> [--focus "..."] [--deep]
  mystic-studio shot <url> [--widths 1280,390] [--full]
  mystic-studio review <url> [--brief "..."] [--deep]
  mystic-studio recheck [session-id] [--url u] [--image p] [--deep]
  mystic-studio generate "<prompt>" [--ar 16:9] [--model m]     spends credits
  mystic-studio edit <image> -p "<instruction>"                 spends credits
  mystic-studio catalog [kind]
  mystic-studio vsee <video> [--focus "..."] [--deep]
  mystic-studio vkey <video> [--count 8]
  mystic-studio vgif <video> [--start 0] [--sec 5] [--width 480]
  mystic-studio serve                          start the HTTP job API

First run: copy .env.example to ~/.config/mystic-studio/.env and add your
GEMINI_API_KEY. Then run: mystic-studio doctor`);
}

function main() {
  const argv = process.argv.slice(2);
  const verb = argv[0];
  if (!verb || verb === 'help' || verb === '--help') { usage(); process.exit(verb ? 0 : 2); }

  const pos = [];
  const args = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--deep') { args.deep = true; continue; }
    if (a === '--full' || a === '--full_page') { args.full_page = true; continue; }
    if (a.startsWith('--')) {
      const k = a.slice(2), v = argv[++i];
      args[k] = BOOL.has(k) ? true : (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
      continue;
    }
    pos.push(a);
  }

  let name;
  switch (verb) {
    case 'doctor': name = 'studio_doctor'; break;
    case 'see': name = 'photo_see'; args.image = pos[0]; break;
    case 'shot': name = 'web_shot'; args.url = pos[0]; if (args.widths && typeof args.widths === 'string') args.widths = args.widths.split(',').map(Number); break;
    case 'review': name = 'web_review'; args.url = pos[0]; break;
    case 'recheck': name = 'recheck'; if (pos[0] && !pos[0].startsWith('-')) args.session = pos[0]; break;
    case 'generate': name = 'photo_generate'; args.prompt = pos[0]; break;
    case 'edit': name = 'photo_edit'; args.image = pos[0]; break;
    case 'catalog': name = 'studio_catalog'; if (pos[0]) args.kind = pos[0]; break;
    case 'vsee': name = 'video_see'; args.video = pos[0]; break;
    case 'vkey': name = 'video_keyframes'; args.video = pos[0]; break;
    case 'vgif': name = 'video_gif'; args.video = pos[0]; break;
    case 'serve': {
      const http = path.join(__dirname, 'http.js');
      const r = spawnSync(process.execPath, [http, ...argv.slice(1)], { stdio: 'inherit' });
      process.exit(r.status || 0);
      return;
    }
    default: usage(); process.exit(2);
  }

  if (verb !== 'doctor') {
    if (name === 'photo_edit' && args.p !== undefined) { args.instruction = args.p; delete args.p; }
    if (name === 'video_gif' && args.sec !== undefined) { args.seconds = args.sec; delete args.sec; }
  }

  const tmp = path.join(os.tmpdir(), `studio-cli-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(args));
  const r = spawnSync(process.execPath, [RUN, name, tmp], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { fs.unlinkSync(tmp); } catch {}
  let out = null;
  try { out = JSON.parse((r.stdout || '').trim().split('\n').filter(Boolean).pop() || 'null'); } catch {}
  if (out && out.ok) { console.log(out.text); process.exit(0); }
  if (out && out.error) console.error(`ERROR: ${out.error}`);
  else { if (r.stderr) process.stderr.write(r.stderr); if (r.stdout) process.stdout.write(r.stdout); }
  process.exit(r.status || 1);
}
main();
