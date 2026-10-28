#!/usr/bin/env node
// Usage: engine-agent --engine <path> --token <token> --server <ws(s)://host/ws/agent>
const { Agent } = require('../src/agent');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith('--') || argv[i + 1] === undefined) return null;
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

const a = args(process.argv.slice(2));
if (!a || !a.engine || !a.token || !a.server) {
  console.error('usage: engine-agent --engine <path> --token <token> --server <wss://host/ws/agent>');
  process.exit(2);
}

const agent = new Agent({ enginePath: a.engine, token: a.token, serverUrl: a.server });
agent.on('status', (s) => console.log(s));
agent.on('fatal', (why) => { console.error(`stopped: ${why}`); agent.stop().then(() => process.exit(1)); });
process.on('SIGINT', () => agent.stop().then(() => process.exit(0)));
agent.start().catch((err) => { console.error(err.message); process.exit(1); });
