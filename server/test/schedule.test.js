const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSchedule } = require('../src/schedule');

const o = (n) => [{ x: n, y: n }];

test('schedule pairs swap sides', () => {
  const s = buildSchedule([o(1), o(2)], 4);
  assert.deepEqual(s.map((g) => [g.gameIndex, g.opening, g.firstPlayer]), [
    [0, o(1), 'A'], [1, o(1), 'B'], [2, o(2), 'A'], [3, o(2), 'B'],
  ]);
});

test('odd games gives last opening one game', () => {
  const s = buildSchedule([o(1), o(2)], 3);
  assert.equal(s.length, 3);
  assert.deepEqual(s[2].opening, o(2));
  assert.equal(s[2].firstPlayer, 'A');
});

test('too few openings throws tooFew', () => {
  assert.throws(() => buildSchedule([o(1)], 4), (e) => e.code === 'tooFew');
  assert.throws(() => buildSchedule([], 1), (e) => e.code === 'tooFew');
});
