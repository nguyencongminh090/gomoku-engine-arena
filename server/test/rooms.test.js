const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomRegistry } = require('../src/rooms');
const { openDb } = require('../src/db');

const cfg = (extra = {}) => ({
  rule: 'freestyle', w: 15, h: 15, games: 4, matchMs: 60000, turnMs: 10000,
  openingsText: '7,7\n8,8 7,8', ...extra,
});

function make(opts = {}) {
  const t = { v: 1_000_000, now: () => t.v };
  const db = openDb(':memory:');
  const reg = new RoomRegistry({ db, now: t.now, ...opts });
  return { t, db, reg };
}

function code(fn) {
  try { fn(); } catch (e) { return e.code; }
  return null;
}

test('token is at least 128 bits', () => {
  const { reg } = make();
  const r = reg.create('1.1.1.1', cfg());
  for (const tok of [r.tokenA, r.tokenB]) assert.ok(Buffer.from(tok, 'base64url').length >= 16, tok);
  assert.notEqual(r.tokenA, r.tokenB);
  assert.notEqual(r.viewId, r.roomId);
});

test('authenticate maps tokens to players and rejects wrong token', () => {
  const { reg } = make();
  const r = reg.create('1.1.1.1', cfg());
  assert.equal(reg.authenticate(r.roomId, r.tokenA), 'A');
  assert.equal(reg.authenticate(r.roomId, r.tokenB), 'B');
  assert.equal(reg.authenticate(r.roomId, 'nope'), null);
  assert.equal(reg.authenticate(r.roomId, r.tokenA + 'x'), null);
  assert.equal(reg.authenticate('missing', r.tokenA), null);
  assert.equal(reg.authenticate(r.roomId, 123), null);
});

test('sixth room from same ip rejected', () => {
  const { reg } = make();
  for (let i = 0; i < 5; i++) reg.create('2.2.2.2', cfg());
  assert.equal(code(() => reg.create('2.2.2.2', cfg())), 'ipLimit');
  assert.doesNotThrow(() => reg.create('3.3.3.3', cfg()));
});

test('room expires after 24h idle', () => {
  const { reg, t } = make();
  const r = reg.create('1.1.1.1', cfg());
  t.v += 23 * 3600e3;
  reg.touch(r.roomId); // activity resets the idle timer
  t.v += 23 * 3600e3;
  assert.equal(reg.authenticate(r.roomId, r.tokenA), 'A');
  assert.equal(reg.sweep(), 0);
  t.v += 25 * 3600e3;
  assert.equal(reg.authenticate(r.roomId, r.tokenA), null);
  assert.equal(reg.sweep(), 1);
  assert.equal(reg.get(r.roomId), null);
});

test('expired rooms free up the ip quota', () => {
  const { reg, t } = make();
  for (let i = 0; i < 5; i++) reg.create('2.2.2.2', cfg());
  t.v += 25 * 3600e3;
  assert.doesNotThrow(() => reg.create('2.2.2.2', cfg()));
});

test('creator can delete', () => {
  const { reg } = make();
  const r = reg.create('1.1.1.1', cfg());
  assert.equal(reg.delete(r.roomId, 'wrong'), false);
  assert.equal(reg.authenticate(r.roomId, r.tokenA), 'A');
  assert.equal(reg.delete(r.roomId, r.creatorSecret), true);
  assert.equal(reg.authenticate(r.roomId, r.tokenA), null);
  assert.equal(reg.delete(r.roomId, r.creatorSecret), false);
});

test('bad config rejected: size out of 5..22', () => {
  const { reg } = make();
  for (const bad of [{ w: 4 }, { w: 23 }, { h: 4 }, { h: 23 }, { w: 7.5 }, { w: '15' }]) {
    assert.equal(code(() => reg.create('1.1.1.1', cfg(bad))), 'badConfig', JSON.stringify(bad));
  }
  assert.doesNotThrow(() => reg.create('1.1.1.1', cfg({ w: 22, h: 5, openingsText: '2,2\n3,3' })));
});

test('bad config rejected: too few openings', () => {
  const { reg } = make();
  assert.equal(code(() => reg.create('1.1.1.1', cfg({ games: 6 }))), 'badConfig'); // 2 openings < 3
  assert.equal(code(() => reg.create('1.1.1.1', cfg({ openingsText: '' }))), 'badConfig');
  assert.doesNotThrow(() => reg.create('1.1.1.1', cfg({ games: 1, openingsText: '-' })));
});

test('bad config rejected: rule, games, clocks, reconnect, opening content', () => {
  const { reg } = make();
  for (const bad of [
    { rule: 'renju' }, { games: 0 }, { games: 1.5 }, { games: 1000 }, { matchMs: 0 }, { turnMs: -1 },
    { reconnectSec: 0 }, { reconnectSec: 100000 }, { openingsText: '99,99' }, { openingsText: 7 },
  ]) {
    assert.equal(code(() => reg.create('1.1.1.1', cfg(bad))), 'badConfig', JSON.stringify(bad));
  }
  assert.equal(code(() => reg.create('1.1.1.1', null)), 'badConfig');
});

test('rooms and tokens survive a registry restart via the db', () => {
  const { reg, db, t } = make();
  const r = reg.create('1.1.1.1', cfg());
  const again = new RoomRegistry({ db, now: t.now });
  assert.equal(again.authenticate(r.roomId, r.tokenB), 'B');
  const room = again.get(r.roomId);
  assert.equal(room.schedule.length, 4);
  assert.equal(room.cfg.reconnectSec, 60);
  assert.equal(again.getByViewId(r.viewId).id, r.roomId);
});

test('resolveToken finds room and player from the token alone', () => {
  const { reg } = make();
  const r = reg.create('1.1.1.1', cfg());
  assert.deepEqual(reg.resolveToken(r.tokenB), { roomId: r.roomId, player: 'B' });
  assert.equal(reg.resolveToken(r.tokenA + 'x'), null);
  assert.equal(reg.resolveToken('nodot'), null);
  assert.equal(reg.resolveToken(42), null);
});

test('config errors carry a stable detail code (and the line for openings) for the UI to translate', () => {
  const { reg } = make();
  const detail = (bad) => { try { reg.create('1.1.1.1', bad); } catch (e) { return [e.code, e.detail, e.line]; } return null; };
  assert.deepEqual(detail(cfg({ openingsText: '7,7\n99,99' })), ['badConfig', 'range', 2]);
  assert.deepEqual(detail(cfg({ games: 6 })), ['badConfig', 'tooFew', undefined]);
  assert.deepEqual(detail(cfg({ openingsText: '' })), ['badConfig', 'empty', undefined]);
  assert.equal(detail(cfg({ rule: 'x' }))[1], 'rule');
  assert.equal(detail(cfg({ w: 3 }))[1], 'size');
  assert.equal(detail(cfg({ games: 0 }))[1], 'games');
  assert.equal(detail(cfg({ matchMs: 0 }))[1], 'matchMs');
  assert.equal(detail(cfg({ turnMs: -1 }))[1], 'turnMs');
  assert.equal(detail(cfg({ reconnectSec: 0 }))[1], 'reconnect');
  assert.equal(detail(cfg({ openingsText: 7 }))[1], 'openingsType');
  assert.equal(detail(null)[1], 'config');
});
