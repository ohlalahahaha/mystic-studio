#!/usr/bin/env node
'use strict';
// One-shot runner: `node run.js <tool> <args.json-file>` → one JSON line on stdout.
// Used by the HTTP server (crash-isolated jobs) and the CLI (thin client).

const fs = require('fs');
const { dispatch } = require('./lib/core');

const [name, argsPath] = process.argv.slice(2);
if (!name) { console.error('usage: run.js <tool> [args.json]'); process.exit(2); }
let args = {};
if (argsPath) { try { args = JSON.parse(fs.readFileSync(argsPath, 'utf8')); } catch (e) { console.log(JSON.stringify({ ok: false, error: `bad args json: ${e.message}` })); process.exit(1); } }
try {
  const text = dispatch(name, args);
  console.log(JSON.stringify({ ok: true, text: String(text) }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
}
