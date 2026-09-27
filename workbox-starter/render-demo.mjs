import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'output');
mkdirSync(out, { recursive: true });
const files = new Map(['/before', join(here, 'demo/before.html')], ['/after', join(here, 'demo/after.html')], ['/motion', join(here, 'demo/motion.html')]);
const server = http.createServer((req, res) => {
  const file = files.get(req.url);
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
try {
  for (const name of ['before', 'after', 'motion']) for (const width of [1440, 390, 320]) {
    const output = join(out, `${name}-${width}.png`);
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(here, '../shot.js'), `http://127.0.0.1:${port}/${name}`, output, '--w', String(width), '--h', width === 1440 ? '900' : '844', '--health', `${output}.health.json`], { timeout: 120000 });
      let message = '';
      child.stderr.on('data', (chunk) => { message += chunk; });
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, message }));
    });
    if (result.status !== 0) throw new Error(`Capture failed for ${name}/${width}: ${result.message.slice(0, 400)}`);
    console.log(output);
  }
} finally { server.close(); }
