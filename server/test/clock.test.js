const test = require('node:test');
const assert = require('node:assert/strict');
const { Clock } = require('../src/clock');

function fake() {
  const t = { v: 1000, now: () => t.v };
  return t;
}

test('clock charges latency to player', () => {
  const t = fake();
  const c = new Clock({ matchMs: 10000, turnMs: 5000, now: t.now });
  c.start('A');
  t.v += 700; // includes network round trip
  assert.equal(c.remaining('A'), 9300);
  assert.deepEqual(c.stop(), { elapsedMs: 700 });
  t.v += 5000; // idle time is not charged
  assert.equal(c.remaining('A'), 9300);
  assert.equal(c.remaining('B'), 10000);
});

test('turn timeout loses', () => {
  const t = fake();
  const c = new Clock({ matchMs: 100000, turnMs: 5000, now: t.now });
  c.start('B');
  t.v += 5000;
  assert.equal(c.expired(), null); // exactly at the limit is still in time
  t.v += 1;
  assert.equal(c.expired(), 'turn');
});

test('match budget runs out mid-turn loses', () => {
  const t = fake();
  const c = new Clock({ matchMs: 6000, turnMs: 5000, now: t.now });
  c.start('A'); t.v += 4000; c.stop();
  c.start('A'); t.v += 2001; // 6001 used in total, turn itself only 2001
  assert.equal(c.expired(), 'match');
  assert.equal(c.remaining('A'), 0);
});

test('turnMs 0 means no per-move limit', () => {
  const t = fake();
  const c = new Clock({ matchMs: 100000, turnMs: 0, now: t.now });
  c.start('A'); t.v += 90000;
  assert.equal(c.expired(), null);
});

test('nothing expires while stopped', () => {
  const t = fake();
  const c = new Clock({ matchMs: 10, turnMs: 10, now: t.now });
  t.v += 99999;
  assert.equal(c.expired(), null);
});
