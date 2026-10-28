const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/protocol');

const hello = { type: 'hello', token: 'abc', engine: { name: 'Rapfi', version: '3', kind: 'rapfi' }, limits: { maxW: 22, maxH: 22 } };

test('rejects non-JSON', () => {
  assert.deepEqual(P.parseClientMessage('{nope', 'agent'), { ok: false, reason: 'badJson' });
  assert.equal(P.parseClientMessage('[1]', 'agent').ok, false);
  assert.equal(P.parseClientMessage('null', 'agent').ok, false);
});

test('rejects oversize', () => {
  const big = JSON.stringify({ type: 'log', level: 'info', text: 'x'.repeat(P.MAX_MESSAGE_BYTES) });
  assert.deepEqual(P.parseClientMessage(big, 'agent'), { ok: false, reason: 'oversize' });
  assert.deepEqual(P.parseClientMessage(Buffer.from(big), 'agent'), { ok: false, reason: 'oversize' });
});

test('rejects unknown type', () => {
  assert.deepEqual(P.parseClientMessage('{"type":"rm -rf"}', 'agent'), { ok: false, reason: 'unknownType' });
  assert.deepEqual(P.parseClientMessage('{}', 'agent'), { ok: false, reason: 'unknownType' });
});

test('rejects move with non-integer coords', () => {
  for (const bad of [{ x: 1.5, y: 2 }, { x: '1', y: 2 }, { x: 1 }, { x: null, y: 1 }, { x: 1, y: NaN }]) {
    const r = P.parseClientMessage(JSON.stringify({ type: 'move', gameId: 0, ply: 3, ...bad }), 'agent');
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  assert.equal(P.parseClientMessage(JSON.stringify({ type: 'move', gameId: 0, ply: -1, x: 1, y: 1 }), 'agent').ok, false);
  const ok = P.parseClientMessage(JSON.stringify({ type: 'move', gameId: 0, ply: 3, x: 1, y: 2 }), 'agent');
  assert.deepEqual(ok, { ok: true, msg: { type: 'move', gameId: 0, ply: 3, x: 1, y: 2 } });
});

test('viewer move is rejected', () => {
  const r = P.parseClientMessage(JSON.stringify({ type: 'move', gameId: 0, ply: 0, x: 1, y: 1 }), 'viewer');
  assert.deepEqual(r, { ok: false, reason: 'viewerReadOnly' });
  assert.equal(P.parseClientMessage(JSON.stringify(hello), 'viewer').ok, false);
});

test('hello requires token string', () => {
  assert.equal(P.parseClientMessage(JSON.stringify(hello), 'agent').ok, true);
  for (const mut of [{ token: 5 }, { token: '' }, { token: undefined }, { engine: undefined }, { limits: { maxW: 'x', maxH: 1 } }, { engine: { name: 'a', version: '1', kind: 'evil' } }]) {
    const r = P.parseClientMessage(JSON.stringify({ ...hello, ...mut }), 'agent');
    assert.equal(r.ok, false, JSON.stringify(mut));
  }
});

test('ready, info and log are validated', () => {
  assert.equal(P.parseClientMessage('{"type":"ready","ok":true}', 'agent').ok, true);
  assert.equal(P.parseClientMessage('{"type":"ready","ok":false,"reason":"no"}', 'agent').ok, true);
  assert.equal(P.parseClientMessage('{"type":"ready","ok":"yes"}', 'agent').ok, false);
  assert.equal(P.parseClientMessage('{"type":"log","level":"info","text":"hi"}', 'agent').ok, true);
  assert.equal(P.parseClientMessage('{"type":"log","level":"info","text":5}', 'agent').ok, false);
  assert.equal(P.parseClientMessage('{"type":"info","data":{"depth":9}}', 'agent').ok, true);
});

test('builders round-trip through parse', () => {
  const stones = [{ x: 1, y: 2, c: 1 }];
  const msgs = [
    P.config({ rule: 'caro', w: 15, h: 12, matchMs: 1000, turnMs: 100 }),
    P.go({ gameId: 2, ply: 1, stones, toMove: 2, timeLeftMs: 900, turnMs: 100 }),
    P.stop(),
    P.gameOver({ gameId: 2, result: { winner: 'A', reason: 'five' } }),
    P.ping(),
  ];
  const types = msgs.map((m) => P.parseServerMessage(m)).map((r) => { assert.equal(r.ok, true); return r.msg.type; });
  assert.deepEqual(types, ['config', 'go', 'stop', 'gameOver', 'ping']);
  assert.deepEqual(P.parseServerMessage(msgs[1]).msg.stones, stones);
  assert.equal(P.parseServerMessage('{"type":"go"}').ok, false);
  assert.equal(P.parseServerMessage(P.config({ rule: 'bogus', w: 15, h: 15, matchMs: 1, turnMs: 1 })).ok, false);
});
