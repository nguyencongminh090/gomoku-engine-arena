const test = require('node:test');
const { after } = test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { startServer } = require('../server/src/server');
const { openDb } = require('../server/src/db');
const { Agent } = require('../agent/src/agent');

const FAKE = path.join(__dirname, '../agent/test/fake-engine.js');
const cleanup = [];
after(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

// Whole system: real server, two real agents driving scripted engines, a viewer, SQLite on disk.
// A's engine races along row 0 and B's along row 5, so whoever moves first (counting opening stones) wins in five moves.
test('4-game caro match on a 15x12 board plays to a stored result', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-e2e-'));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'e2e.sqlite');
  const srv = await startServer({ port: 0, dbPath });
  let closed = false;
  const closeServer = async () => { if (!closed) { closed = true; await srv.close(); } };
  cleanup.push(closeServer);
  const base = `http://127.0.0.1:${srv.port}`;

  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rule: 'caro', w: 15, h: 12, games: 4, matchMs: 120000, turnMs: 20000, reconnectSec: 30,
      // Opening 1 is the empty board (first mover wins the race); opening 2 has one stone, so the second mover wins.
      openingsText: '-\n14,11',
    }),
  });
  assert.equal(res.status, 201);
  const room = await res.json();

  const events = [];
  const viewer = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/view/${room.viewId}`);
  cleanup.push(() => viewer.terminate());
  viewer.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'event') events.push(m.event); });
  await new Promise((r) => viewer.on('open', r));

  const mkAgent = (token, row) => {
    const agent = new Agent({
      enginePath: process.execPath, engineArgs: [FAKE], token, serverUrl: `ws://127.0.0.1:${srv.port}/ws/agent`,
      engineEnv: { ...process.env, FAKE_THINK_MS: '10', FAKE_ROW: String(row) },
    });
    cleanup.push(() => agent.stop());
    return agent;
  };
  await mkAgent(room.tokenA, 0).start();
  await mkAgent(room.tokenB, 5).start();

  const deadline = Date.now() + 50000;
  while (!events.some((e) => e.type === 'matchOver')) {
    if (Date.now() > deadline) throw new Error(`match did not finish; events: ${events.map((e) => e.type).join(',')}`);
    await new Promise((r) => setTimeout(r, 50));
  }

  const overs = events.filter((e) => e.type === 'gameOver');
  assert.deepEqual(overs.map((e) => e.result), [
    { winner: 'A', reason: 'five' }, { winner: 'B', reason: 'five' },
    { winner: 'B', reason: 'five' }, { winner: 'A', reason: 'five' },
  ]);
  assert.deepEqual(events.find((e) => e.type === 'matchOver'), { type: 'matchOver', score: { A: 2, B: 2, draws: 0 }, winner: null });
  // The viewer saw every move of every game: 9 each (5 by the winner, 4 by the loser).
  assert.equal(events.filter((e) => e.type === 'move').length, 36);
  assert.deepEqual(events.filter((e) => e.type === 'gameStart').map((e) => e.firstPlayer), ['A', 'B', 'A', 'B']);

  await closeServer();
  const saved = openDb(dbPath).loadMatch(room.roomId).games;
  assert.equal(saved.length, 4);
  assert.deepEqual(saved.map((g) => g.result.winner), ['A', 'B', 'B', 'A']);
  assert.ok(saved.every((g) => g.moves.length === 9));
  assert.deepEqual(saved[2].opening, [{ x: 14, y: 11 }]);
});
