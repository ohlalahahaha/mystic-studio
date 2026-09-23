#!/usr/bin/env node
'use strict';
// MCP stdio server. Newline-delimited JSON-RPC, protocol 2024-11-05.
// Register in any MCP client: command = node, args = [this file].

const { dispatch, TOOLS } = require('./lib/core');

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function handle(m) {
  const { id, method } = m;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mystic-studio-mcp', version: '1.0.0' } } });
  } else if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
  } else if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  } else if (method === 'tools/call') {
    const { name, arguments: args } = m.params || {};
    try { send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(dispatch(name, args || {})) }] } }); }
    catch (e) { send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `ERROR: ${e.message}` }], isError: true } }); }
  } else if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
  }
}
