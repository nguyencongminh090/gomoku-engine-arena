const test = require('node:test');
const assert = require('node:assert/strict');
const { GameState } = require('../src/game');

function make(extra = {}) {
  const t = { v: 0, now: () => t.v };
  const game = new GameState({
    w: 15, h: 15, rule: 'freestyle', opening: [], firstPlayer: 'A',
    matchMs: 60000, turnMs: 10000, now: t.now, ...extra,
  });
  return { t, game };
}

test('submit applies move and flips turn', () => {
  const { game } = make();
  assert.equal(game.toMove, 'A');
  assert.equal(game.ply, 0);
  assert.deepEqual(game.submit('A', 0, 7, 7), { ok: true });
  assert.equal(game.toMove, 'B');
  assert.equal(game.ply, 1);
  assert.deepEqual(game.stones(), [{ x: 7, y: 7, c: 1 }]);
});

test('submit from the wrong player is rejected', () => {
  const { game } = make();
  assert.deepEqual(game.submit('B', 0, 7, 7), { ok: false, reason: 'notYourTurn' });
  assert.equal(game.ply, 0);
});

test('submit on occupied cell is rejected and game continues', () => {
  const { game } = make();
  game.submit('A', 0, 7, 7);
  assert.deepEqual(game.submit('B', 1, 7, 7), { ok: false, reason: 'occupied' });
  assert.equal(game.toMove, 'B');
  assert.deepEqual(game.submit('B', 1, 8, 8), { ok: true });
});

test('submit outside the board is rejected', () => {
  const { game } = make();
  assert.equal(game.submit('A', 0, 15, 0).reason, 'range');
  assert.equal(game.submit('A', 0, -1, 0).reason, 'range');
  assert.equal(game.submit('A', 0, 1.5, 0).reason, 'range');
});

test('submit with wrong ply is rejected', () => {
  const { game } = make();
  assert.deepEqual(game.submit('A', 3, 7, 7), { ok: false, reason: 'badPly' });
  game.submit('A', 0, 7, 7);
  assert.deepEqual(game.submit('B', 0, 8, 8), { ok: false, reason: 'badPly' }); // duplicate/stale
});

test('five in a row ends game with winner', () => {
  const { game } = make();
  let res;
  for (let i = 0; i < 5; i++) {
    game.submit('A', game.ply, i, 0);
    res = game.submit('A', game.ply, 0, 0).ok; // wrong turn, ignored
    if (i < 4) game.submit('B', game.ply, i, 5);
  }
  assert.equal(res, false);
  assert.deepEqual(game.result, { winner: 'A', reason: 'five' });
});

test('submit after over is rejected', () => {
  const { game } = make();
  for (let i = 0; i < 4; i++) { game.submit('A', game.ply, i, 0); game.submit('B', game.ply, i, 5); }
  const last = game.submit('A', game.ply, 4, 0);
  assert.deepEqual(last, { ok: true, result: { winner: 'A', reason: 'five' } });
  assert.deepEqual(game.submit('B', game.ply, 9, 9), { ok: false, reason: 'over' });
});

test('full board is a draw', () => {
  // 5x5 board; fill in an order that never lets either side win.
  const { game } = make({ w: 5, h: 5 });
  // Column-pair pattern: black on (x+2*(y>>0)... use explicit safe fill by rows of alternating pairs.
  const colour = (x, y) => ((x >> 1) + y) % 2; // 0 -> black, 1 -> white
  const blacks = [], whites = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) (colour(x, y) === 0 ? blacks : whites).push([x, y]);
  // 13 vs 12 split is wrong for alternation? Black plays 13, white 12: matches 25 plies.
  assert.equal(blacks.length, 13);
  let result;
  for (let i = 0; i < 25; i++) {
    const [x, y] = i % 2 === 0 ? blacks[i >> 1] : whites[i >> 1];
    const r = game.submit(i % 2 === 0 ? 'A' : 'B', game.ply, x, y);
    assert.equal(r.ok, true, `ply ${i}`);
    if (r.result) result = r.result;
  }
  assert.deepEqual(result, { winner: null, reason: 'full' });
});

test('opening stones count in ply and first mover', () => {
  const { game } = make({ opening: [{ x: 7, y: 7 }, { x: 8, y: 8 }, { x: 6, y: 6 }] });
  assert.equal(game.ply, 3);
  assert.equal(game.toMove, 'B'); // three stones: colour 2 to move; A moved first (colour 1)
  assert.deepEqual(game.stones().map((s) => s.c), [1, 2, 1]);
  assert.equal(game.submit('B', 3, 0, 0).ok, true);
  assert.deepEqual(game.stones()[3], { x: 0, y: 0, c: 2 });
});

test('first player B plays colour 1', () => {
  const { game } = make({ firstPlayer: 'B' });
  assert.equal(game.toMove, 'B');
  game.submit('B', 0, 1, 1);
  assert.equal(game.stones()[0].c, 1);
});

test('turn timeout ends the game; a late move is not applied', () => {
  const { game, t } = make({ turnMs: 1000 });
  t.v += 1001;
  assert.deepEqual(game.timeout(), { winner: 'B', reason: 'timeoutTurn' });
  assert.equal(game.submit('A', 0, 1, 1).reason, 'over');
});

test('a late move submitted before timeout() is called loses on time', () => {
  const { game, t } = make({ turnMs: 1000 });
  t.v += 1500;
  const r = game.submit('A', 0, 1, 1);
  assert.equal(r.ok, false);
  assert.deepEqual(game.result, { winner: 'B', reason: 'timeoutTurn' });
  assert.deepEqual(game.stones(), []);
});

test('match budget exhaustion is reported as timeoutMatch', () => {
  const { game, t } = make({ matchMs: 1500, turnMs: 1000 });
  t.v += 900; game.submit('A', 0, 1, 1);
  t.v += 100; game.submit('B', 1, 2, 2);
  t.v += 700; // A has now used 1600 > 1500, but this turn only 700
  assert.deepEqual(game.timeout(), { winner: 'B', reason: 'timeoutMatch' });
});

test('forfeit gives the win to the other player', () => {
  const { game } = make();
  assert.deepEqual(game.forfeit('A', 'disconnect'), { winner: 'B', reason: 'disconnect' });
  assert.deepEqual(game.forfeit('B', 'illegal'), { winner: 'B', reason: 'disconnect' }); // already over
});

test('timeLeftMs reflects the running clock', () => {
  const { game, t } = make();
  t.v += 2500;
  assert.equal(game.timeLeftMs('A'), 57500);
  assert.equal(game.timeLeftMs('B'), 60000);
});

test('moveLog records each move with its elapsed time', () => {
  const { game, t } = make();
  t.v += 300; game.submit('A', 0, 1, 1);
  t.v += 120; game.submit('B', 1, 2, 2);
  assert.deepEqual(game.moveLog, [
    { ply: 0, player: 'A', x: 1, y: 1, elapsedMs: 300 },
    { ply: 1, player: 'B', x: 2, y: 2, elapsedMs: 120 },
  ]);
});
