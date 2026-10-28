const test = require('node:test');
const { after } = test;
const assert = require('node:assert/strict');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { Agent } = require('../src/agent');

const FAKE = path.join(__dirname, 'fake-engine.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const config = (extra = {}) => ({ type: 'config', rule: 'freestyle', w: 15, h: 15, matchMs: 600000, turnMs: 0, ...extra });
const go = (extra = {}) => ({ type: 'go', gameId: 0, ply: 0, stones: [], toMove: 1, timeLeftMs: 600000, turnMs: 0, ...extra });

const cleanup = [];
after(async () => { for (const fn of cleanup.splice(0)) await fn(); });

// A scripted server: `onConnection(ctx)` is called for every agent connection with helpers.
async function scriptedServer(onConnection) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.on('listening', r));
  let n = 0;
  wss.on('connection', (ws) => {
    const conn = { ws, index: n++, inbox: [], send: (m) => ws.send(JSON.stringify(m)) };
    ws.on('message', (d) => { conn.inbox.push(JSON.parse(d.toString())); });
    onConnection(conn);
  });
  cleanup.push(() => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(r); }));
  return `ws://127.0.0.1:${wss.address().port}`;
}

async function until(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = pred(); if (v) return v; await sleep(10); }
  throw new Error('timed out');
}

async function startAgent(url, env = {}, opts = {}) {
  const agent = new Agent({ enginePath: FAKE, token: 'room.secret', serverUrl: url, engineEnv: { ...process.env, ...env }, reconnectMs: 50, ...opts });
  cleanup.push(() => agent.stop());
  await agent.start();
  return agent;
}

test('agent sends hello with the detected engine, then ready ok after config', async () => {
  let conn;
  const url = await scriptedServer((c) => { conn = c; });
  await startAgent(url, { FAKE_KIND: 'rapfi' });
  await until(() => conn && conn.inbox.length);
  assert.deepEqual(conn.inbox[0], { type: 'hello', token: 'room.secret', engine: { name: 'Rapfi', version: '0.43.02 (fake)', kind: 'rapfi' }, limits: { maxW: 22, maxH: 22 } });
  conn.send(config({ rule: 'caro', w: 15, h: 12 }));
  const ready = await until(() => conn.inbox.find((m) => m.type === 'ready'));
  assert.deepEqual(ready, { type: 'ready', ok: true });
});

test('agent replies ready ok:false with reason', async () => {
  let conn;
  const url = await scriptedServer((c) => { conn = c; });
  await startAgent(url, { FAKE_KIND: 'classic' });
  await until(() => conn && conn.inbox.length);
  conn.send(config({ rule: 'standard' }));
  const ready = await until(() => conn.inbox.find((m) => m.type === 'ready'));
  assert.equal(ready.ok, false);
  assert.match(ready.reason, /freestyle/);
  // An unrecognised engine is refused too.
  let conn2;
  const url2 = await scriptedServer((c) => { conn2 = c; });
  await startAgent(url2, { FAKE_KIND: 'unknown' });
  await until(() => conn2 && conn2.inbox.length);
  assert.equal(conn2.inbox[0].engine.kind, 'unknown');
  conn2.send(config());
  assert.equal((await until(() => conn2.inbox.find((m) => m.type === 'ready'))).ok, false);
});

test('agent replies ready ok:false naming the engine command that failed', async () => {
  let conn;
  const url = await scriptedServer((c) => { conn = c; });
  await startAgent(url, { FAKE_KIND: 'rapfi', FAKE_NO_RULE: '1' });
  await until(() => conn && conn.inbox.length);
  conn.send(config({ rule: 'standard' }));
  const ready = await until(() => conn.inbox.find((m) => m.type === 'ready'));
  assert.equal(ready.ok, false);
  assert.match(ready.reason, /INFO RULE 1/);
});

test('agent answers go with exactly one move', async () => {
  let conn;
  const url = await scriptedServer((c) => { conn = c; });
  await startAgent(url, { FAKE_THINK_MS: '50' });
  await until(() => conn && conn.inbox.length);
  conn.send(config());
  await until(() => conn.inbox.find((m) => m.type === 'ready'));
  conn.send(go({ gameId: 3, ply: 2, stones: [{ x: 0, y: 0, c: 1 }, { x: 1, y: 0, c: 2 }] }));
  const move = await until(() => conn.inbox.find((m) => m.type === 'move'));
  assert.deepEqual(move, { type: 'move', gameId: 3, ply: 2, x: 2, y: 0 });
  await sleep(300);
  assert.equal(conn.inbox.filter((m) => m.type === 'move').length, 1);
});

test('go before a successful config is ignored', async () => {
  let conn;
  const url = await scriptedServer((c) => { conn = c; });
  await startAgent(url);
  await until(() => conn && conn.inbox.length);
  conn.send(go());
  await sleep(300);
  assert.equal(conn.inbox.filter((m) => m.type === 'move').length, 0);
});

test('gameOver during search aborts and discards result', async () => {
  let conn;
  const url = await scriptedServer((c) => { conn = c; });
  await startAgent(url, { FAKE_THINK_MS: '400' });
  await until(() => conn && conn.inbox.length);
  conn.send(config());
  await until(() => conn.inbox.find((m) => m.type === 'ready'));
  conn.send(go({ gameId: 0, ply: 0 }));
  await sleep(100);
  conn.send({ type: 'gameOver', gameId: 0, result: { winner: 'A', reason: 'five' } });
  await sleep(700);
  assert.equal(conn.inbox.filter((m) => m.type === 'move').length, 0);
  // The next game's search is not poisoned by the discarded one.
  conn.send(go({ gameId: 1, ply: 1, stones: [{ x: 0, y: 0, c: 1 }] }));
  const move = await until(() => conn.inbox.find((m) => m.type === 'move'));
  assert.deepEqual(move, { type: 'move', gameId: 1, ply: 1, x: 1, y: 0 });
});

test('stop aborts the search without a move', async () => {
  let conn;
  const url = await scriptedServer((c) => { conn = c; });
  await startAgent(url, { FAKE_THINK_MS: '400' });
  await until(() => conn && conn.inbox.length);
  conn.send(config());
  await until(() => conn.inbox.find((m) => m.type === 'ready'));
  conn.send(go());
  await sleep(100);
  conn.send({ type: 'stop' });
  await sleep(700);
  assert.equal(conn.inbox.filter((m) => m.type === 'move').length, 0);
});

test('agent reconnects and answers a resent go', async () => {
  const conns = [];
  const url = await scriptedServer((c) => {
    conns.push(c);
    if (c.index === 0) {
      c.ws.once('message', () => { // hello
        c.send(config());
        c.ws.on('message', (d) => {
          if (JSON.parse(d.toString()).type === 'ready') { c.send(go()); setTimeout(() => c.ws.terminate(), 10); }
        });
      });
    }
  });
  await startAgent(url, { FAKE_THINK_MS: '200' });
  await until(() => conns[1] && conns[1].inbox.length); // reconnected and said hello again
  assert.equal(conns[1].inbox[0].type, 'hello');
  conns[1].send(config());
  await until(() => conns[1].inbox.find((m) => m.type === 'ready'));
  conns[1].send(go());
  const move = await until(() => conns[1].inbox.find((m) => m.type === 'move'));
  assert.deepEqual(move, { type: 'move', gameId: 0, ply: 0, x: 0, y: 0 });
  await sleep(300);
  assert.equal(conns[0].inbox.filter((m) => m.type === 'move').length, 0); // the old answer went nowhere
  assert.equal(conns[1].inbox.filter((m) => m.type === 'move').length, 1);
});

test('agent stops reconnecting when the server says the token is bad', async () => {
  let count = 0;
  const url = await scriptedServer((c) => { count++; c.ws.close(4401, 'bad token'); });
  const agent = await startAgent(url);
  await sleep(500);
  assert.equal(count, 1);
  assert.equal(agent.fatal, 'bad token');
});
