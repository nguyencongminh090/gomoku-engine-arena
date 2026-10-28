// Cross-checks checkWin against a real Rapfi. Rapfi never announces a result, so the check is behavioural:
// when our rules say a winning move exists, the engine (which always plays an immediate win) must pick one of
// the cells we call winning, and when our rules say none exists it must not play a line-completing decoy.
// Set RAPFI_ENGINE=/path/to/pbrain-rapfi to run; skipped otherwise.
const test = require('node:test');
const { after } = test;
const assert = require('node:assert/strict');
const { Board } = require('../src/board');
const { checkWin } = require('../src/rules');
const { EngineProcess } = require('../../agent/src/engine-process');
const { SearchSession } = require('../../agent/src/search');
const rapfi = require('../../agent/src/adapters/rapfi');

const ENGINE = process.env.RAPFI_ENGINE;
const skip = ENGINE ? false : 'set RAPFI_ENGINE to a pbrain-rapfi binary to run the oracle';
const W = 15;
const H = 15;
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

const procs = [];
after(() => { for (const p of procs) if (p.child) p.child.kill('SIGKILL'); });

async function engineFor(rule) {
  const proc = new EngineProcess(ENGINE);
  procs.push(proc);
  proc.start();
  const session = new SearchSession(proc, rapfi, { graceMs: 5000 });
  session.configure({ rule, w: W, h: H, matchMs: 600000, turnMs: 400 });
  await new Promise((r) => setTimeout(r, 800)); // let the net load
  return session;
}

// Interleaves black/white stones in play order. `x` is the side to move, so counts must match its colour.
function position(xCells, oCells, xIsBlack) {
  const x = xCells.map((c) => ({ ...c }));
  const o = oCells.map((c) => ({ ...c }));
  const pad = [[14, 14], [14, 12], [12, 14], [0, 14], [14, 0], [0, 0], [10, 14]];
  let next = 0;
  const need = (xIsBlack ? x.length : x.length + 1);
  while (o.length < need) { const [px, py] = pad[next++]; o.push({ x: px, y: py }); }
  assert.ok(o.length === need, 'too many opponent stones for the parity');
  const [black, white] = xIsBlack ? [x, o] : [o, x];
  const stones = [];
  for (let i = 0; i < Math.max(black.length, white.length); i++) {
    if (i < black.length) stones.push({ ...black[i], c: 1 });
    if (i < white.length) stones.push({ ...white[i], c: 2 });
  }
  return { stones, xColour: xIsBlack ? 1 : 2 };
}

function boardOf(stones) { return Board.fromStones(W, H, stones); }

function winningCells(stones, colour, rule) {
  const out = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (stones.some((s) => s.x === x && s.y === y)) continue;
      const b = boardOf([...stones, { x, y, c: colour }]);
      if (checkWin(b, x, y, rule)) out.push(`${x},${y}`);
    }
  }
  return out;
}

function rawRun(board, x, y, c) {
  let best = 1;
  for (const [dx, dy] of DIRS) {
    let n = 1;
    for (const s of [1, -1]) {
      let cx = x + s * dx; let cy = y + s * dy;
      while (board.inBounds(cx, cy) && board.get(cx, cy) === c) { n++; cx += s * dx; cy += s * dy; }
    }
    best = Math.max(best, n);
  }
  return best;
}

const row = (y, xs) => xs.map((x) => ({ x, y }));
const keyOf = (m) => `${m.x},${m.y}`;

// Hand-derived cases: [name, rule, X cells, O cells, expected winning cells (from the rule text), decoy cells].
const CASES = [
  ['freestyle: open four wins at either end', 'freestyle', row(7, [3, 4, 5, 6]), [], ['2,7', '7,7'], []],
  ['freestyle: filling a gap to make six wins', 'freestyle', row(7, [3, 4, 6, 7, 8]), [], ['5,7'], []],
  ['standard: exactly five wins', 'standard', row(7, [3, 4, 5, 6]), row(7, [2]), ['7,7'], []],
  ['standard: six does not win', 'standard', row(7, [3, 4, 6, 7, 8]), [], [], ['5,7']],
  ['caro: five blocked at one end wins', 'caro', row(7, [3, 4, 5, 6]), row(7, [2]), ['7,7'], []],
  ['caro: five blocked at both ends does not win', 'caro', row(7, [3, 4, 5, 6]), row(7, [2, 8]), [], ['7,7']],
  ['caro: five touching the edge wins (edge does not block)', 'caro', row(7, [0, 1, 2, 3]), row(7, [5]), ['4,7'], []],
  ['caro: six wins even when both ends are blocked', 'caro', row(7, [3, 4, 6, 7, 8]), row(7, [2, 9]), ['5,7'], []],
];

for (const [name, rule, xCells, oCells, expected, decoys] of CASES) {
  for (const xIsBlack of [true, false]) {
    test(`oracle: ${name} (${xIsBlack ? 'black' : 'white'} to move)`, { skip }, async () => {
      const { stones, xColour } = position(xCells, oCells, xIsBlack);
      assert.deepEqual(winningCells(stones, xColour, rule).sort(), [...expected].sort(), 'our rule disagrees with the hand-derived answer');
      const session = await engineFor(rule);
      const move = await session.search({ stones, toMove: xColour, timeLeftMs: 600000, turnMs: 400, w: W, h: H });
      if (expected.length) assert.ok(expected.includes(keyOf(move)), `engine played ${keyOf(move)}, expected one of ${expected}`);
      else assert.ok(!decoys.includes(keyOf(move)), `engine played the non-winning decoy ${keyOf(move)}`);
    });
  }
}

// Seeded random positions with a planted line for X.
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function randomPosition(rand, rule) {
  const pick = (n) => Math.floor(rand() * n);
  for (let attempt = 0; attempt < 200; attempt++) {
    const [dx, dy] = DIRS[pick(4)];
    const shape = pick(3); // 0: four in a row, 1: 2+gap+2, 2: 3+gap+1
    const offsets = shape === 0 ? [0, 1, 2, 3] : shape === 1 ? [0, 1, 3, 4] : [0, 1, 2, 4];
    const sx = pick(W); const sy = pick(H);
    const xCells = offsets.map((k) => ({ x: sx + k * dx, y: sy + k * dy }));
    if (!xCells.every((c) => c.x >= 0 && c.y >= 0 && c.x < W && c.y < H)) continue;
    const taken = new Set(xCells.map(keyOf));
    const free = () => { for (let i = 0; i < 50; i++) { const c = { x: pick(W), y: pick(H) }; if (!taken.has(keyOf(c))) { taken.add(keyOf(c)); return c; } } return null; };
    const oCells = [];
    // Blockers at the line ends about half of the time, so every Caro/Standard edge shape appears.
    for (const k of [-1, 5, 4]) {
      const c = { x: sx + k * dx, y: sy + k * dy };
      if (rand() < 0.5 && c.x >= 0 && c.y >= 0 && c.x < W && c.y < H && !taken.has(keyOf(c))) { oCells.push(c); taken.add(keyOf(c)); }
    }
    for (let i = pick(4); i > 0; i--) { const c = free(); if (c) oCells.push(c); }
    const extraX = pick(3);
    for (let i = 0; i < extraX; i++) { const c = free(); if (c) xCells.push(c); }
    const xIsBlack = rand() < 0.5;
    if (oCells.length > (xIsBlack ? xCells.length : xCells.length + 1)) continue;
    const { stones, xColour } = position(xCells, oCells, xIsBlack);
    const board = boardOf(stones);
    const oColour = 3 - xColour;
    // No finished line for either side, and the opponent must not have a win of its own to answer.
    if (stones.some((s) => rawRun(board, s.x, s.y, s.c) >= 5)) continue;
    if (winningCells(stones, oColour, rule).length) continue;
    return { stones, xColour };
  }
  throw new Error('could not generate a position');
}

for (const rule of ['freestyle', 'standard', 'caro']) {
  test(`oracle: random positions agree with Rapfi under ${rule}`, { skip, timeout: 120000 }, async () => {
    const rand = mulberry32(rule === 'freestyle' ? 11 : rule === 'standard' ? 22 : 33);
    const session = await engineFor(rule);
    let withWin = 0;
    for (let i = 0; i < 24; i++) {
      const { stones, xColour } = randomPosition(rand, rule);
      const wins = winningCells(stones, xColour, rule);
      const move = await session.search({ stones, toMove: xColour, timeLeftMs: 600000, turnMs: 400, w: W, h: H });
      const board = boardOf([...stones, { ...move, c: xColour }]);
      const label = `${rule} #${i} stones=${JSON.stringify(stones.map((s) => `${s.x},${s.y},${s.c}`))} engine=${keyOf(move)}`;
      if (wins.length) {
        withWin++;
        assert.ok(wins.includes(keyOf(move)), `engine missed a win we claim exists (${wins}): ${label}`);
      } else {
        assert.ok(rawRun(board, move.x, move.y, xColour) < 5, `engine completed a line our rule says is not a win: ${label}`);
      }
    }
    assert.ok(withWin >= 4, `generator produced only ${withWin} positions with a winning move`);
  });
}
