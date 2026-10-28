const test = require('node:test');
const assert = require('node:assert/strict');
const { Board } = require('../src/board');
const { RULES, checkWin } = require('../src/rules');

// Horizontal run of `n` stones of colour `c` on row `y` starting at x0, as stone list.
function row(y, x0, n, c = 1) {
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i, y, c }));
}

function win(w, h, stones, x, y, rule) {
  return checkWin(Board.fromStones(w, h, stones), x, y, rule);
}

test('RULES map to INFO RULE values', () => {
  assert.deepEqual(RULES, { freestyle: 0, standard: 1, caro: 8 });
});

test('freestyle: five wins', () => {
  assert.equal(win(15, 15, row(7, 3, 5), 5, 7, 'freestyle'), true);
});

test('freestyle: six wins', () => {
  assert.equal(win(15, 15, row(7, 3, 6), 5, 7, 'freestyle'), true);
});

test('standard: five wins', () => {
  assert.equal(win(15, 15, row(7, 3, 5), 5, 7, 'standard'), true);
});

test('standard: six does not win', () => {
  assert.equal(win(15, 15, row(7, 3, 6), 5, 7, 'standard'), false);
});

test('caro: six wins', () => {
  // Both ends blocked by the opponent, yet 6+ still wins.
  const s = [...row(7, 3, 6), { x: 2, y: 7, c: 2 }, { x: 9, y: 7, c: 2 }];
  assert.equal(win(15, 15, s, 5, 7, 'caro'), true);
});

test('caro: five open both ends wins', () => {
  assert.equal(win(15, 15, row(7, 3, 5), 5, 7, 'caro'), true);
});

test('caro: five blocked one end wins', () => {
  const s = [...row(7, 3, 5), { x: 2, y: 7, c: 2 }];
  assert.equal(win(15, 15, s, 5, 7, 'caro'), true);
});

test('caro: five blocked both ends does not win', () => {
  const s = [...row(7, 3, 5), { x: 2, y: 7, c: 2 }, { x: 8, y: 7, c: 2 }];
  assert.equal(win(15, 15, s, 5, 7, 'caro'), false);
});

test('caro: five at board edge wins (edge does not block)', () => {
  // x=0..4 touches the left edge; right end blocked by the opponent.
  const s = [...row(7, 0, 5), { x: 5, y: 7, c: 2 }];
  assert.equal(win(15, 15, s, 2, 7, 'caro'), true);
  // Both ends at edges of a 5-wide board.
  assert.equal(win(5, 5, row(2, 0, 5), 2, 2, 'caro'), true);
});

test('caro: five with one end edge and other end opponent wins', () => {
  const s = [...row(0, 0, 5), { x: 5, y: 0, c: 2 }];
  assert.equal(win(15, 15, s, 4, 0, 'caro'), true);
});

test('caro: friendly stone at an end does not count as a block', () => {
  // Six in a row is a win, but also check own colour beyond five is not a block:
  // x=3..7 plus own stone at x=8 is six -> wins.
  assert.equal(win(15, 15, row(7, 3, 6), 3, 7, 'caro'), true);
});

test('diagonal and vertical lines are detected', () => {
  const diag = Array.from({ length: 5 }, (_, i) => ({ x: i + 2, y: i + 3, c: 2 }));
  assert.equal(win(15, 15, diag, 4, 5, 'standard'), true);
  const anti = Array.from({ length: 5 }, (_, i) => ({ x: 8 - i, y: i + 1, c: 1 }));
  assert.equal(win(15, 15, anti, 6, 3, 'freestyle'), true);
  const vert = Array.from({ length: 5 }, (_, i) => ({ x: 4, y: i + 2, c: 1 }));
  assert.equal(win(15, 15, vert, 4, 4, 'freestyle'), true);
});

test('win must pass through last move', () => {
  const s = [...row(7, 3, 5), { x: 10, y: 10, c: 1 }];
  assert.equal(win(15, 15, s, 10, 10, 'freestyle'), false);
});

test('four in a row is not a win', () => {
  assert.equal(win(15, 15, row(7, 3, 4), 5, 7, 'freestyle'), false);
});

test('full board without win is not a win', () => {
  // 5x5 board filled in a pattern with no 5-in-row for the last stone.
  const stones = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) stones.push({ x, y, c: ((x >> 0) + (y >> 0) * 2 + (y >> 1)) % 2 === 0 ? 1 : 2 });
  }
  const board = Board.fromStones(5, 5, stones);
  assert.equal(board.isFull(), true);
  assert.equal(checkWin(board, 2, 2, 'freestyle'), false);
});

test('board basics', () => {
  const b = new Board(7, 5);
  assert.equal(b.inBounds(6, 4), true);
  assert.equal(b.inBounds(7, 0), false);
  assert.equal(b.inBounds(0, -1), false);
  assert.equal(b.get(3, 3), 0);
  b.set(3, 3, 2);
  assert.equal(b.get(3, 3), 2);
  assert.equal(b.isFull(), false);
});
