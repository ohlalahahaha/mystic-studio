'use strict';
// Fixture media server for test/video.js — separate PROCESS (parent blocks its own event loop with spawnSync).
// argv: [fixtureMp4, portFile]. Auto-exits after 300s as a safety net.
const http = require('http');
const fs = require('fs');
const land = process.argv[2];
const portFile = process.argv[3];
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/landscape.mp4') {
    const buf = fs.readFileSync(land);
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': buf.length });
    res.end(buf);
  } else if (p === '/fake.mp4') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html>definitely not a video</html>');
  } else if (p === '/watch') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>page that a safe adapter must not blindly download</html>');
  } else if (p === '/slow.mp4') {
    setTimeout(() => { res.writeHead(200, { 'content-type': 'video/mp4' }); res.end('x'); }, 30000);
  } else if (p === '/big.mp4') {
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': 104857600 });
    res.write('0123456789');
  } else { res.writeHead(404); res.end('nope'); }
});
server.listen(0, '127.0.0.1', () => { fs.writeFileSync(portFile, String(server.address().port)); });
setTimeout(() => process.exit(0), 300000);
