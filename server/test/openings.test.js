const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOpenings } = require('../src/openings');

function code(fn) {
  try { fn(); } catch (e) { return e.code; }
  return null;
}

test('parses coords on one line', () => {
  const r = parseOpenings('7,7 8,8;6,7\n', 15, 15, 'freestyle');
  assert.deepEqual(r, [[{ x: 7, y: 7 }, { x: 8, y: 8 }, { x: 6, y: 7 }]]);
});

test('"-" is an empty-board opening and blank lines are skipped', () => {
  const r = parseOpenings('-\n\n7,7\n', 15, 15, 'freestyle');
  assert.deepEqual(r, [[], [{ x: 7, y: 7 }]]);
});

test('rejects out of range', () => {
  assert.equal(code(() => parseOpenings('15,0', 15, 15, 'freestyle')), 'range');
  assert.equal(code(() => parseOpenings('0,-1', 15, 15, 'freestyle')), 'syntax');
  assert.equal(code(() => parseOpenings('12,3', 12, 15, 'freestyle')), 'range');
});

test('rejects syntax errors', () => {
  assert.equal(code(() => parseOpenings('a,b', 15, 15, 'freestyle')), 'syntax');
  assert.equal(code(() => parseOpenings('7 7', 15, 15, 'freestyle')), 'syntax');
  assert.equal(code(() => parseOpenings('1.5,2', 15, 15, 'freestyle')), 'syntax');
});

test('rejects duplicate cell', () => {
  assert.equal(code(() => parseOpenings('3,3 4,4 3,3', 15, 15, 'freestyle')), 'duplicate');
});

test('rejects opening that already has a win', () => {
  // Black stones at (0..4,0), white fillers at (0..3,1) alternate: moves 1,3,5,7,9 are black.
  const text = '0,0 0,1 1,0 1,1 2,0 2,1 3,0 3,1 4,0';
  assert.equal(code(() => parseOpenings(text, 15, 15, 'freestyle')), 'winning');
});

test('rejects empty list', () => {
  assert.equal(code(() => parseOpenings('', 15, 15, 'freestyle')), 'empty');
  assert.equal(code(() => parseOpenings('\n  \n', 15, 15, 'freestyle')), 'empty');
});

test('opening errors carry the offending line number', () => {
  const line = (text) => { try { parseOpenings(text, 15, 15, 'freestyle'); } catch (e) { return e.line; } return null; };
  assert.equal(line('7,7\n99,99'), 2);
  assert.equal(line('7,7\n\n3,3 3,3'), 3);
  assert.equal(line('a,b'), 1);
});
