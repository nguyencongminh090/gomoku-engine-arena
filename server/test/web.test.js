const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startServer } = require('../src/server');

const WEB = path.join(__dirname, '../../web');
// Values built inside the vm context have another realm's prototypes; compare them as plain JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

// The web scripts are classic <script>s that attach to window.TestSite; load them against a stub window.
function loadWeb(...files) {
  const win = {};
  win.window = win;
  const ctx = vm.createContext(win);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(WEB, 'js', f), 'utf8'), ctx, { filename: f });
  return win.TestSite;
}

const htmlFiles = fs.readdirSync(WEB).filter((f) => f.endsWith('.html'));

test('i18n has identical keys in vi and en', () => {
  const { i18n } = loadWeb('i18n.js');
  const vi = Object.keys(i18n.dict.vi).sort();
  const en = Object.keys(i18n.dict.en).sort();
  assert.deepEqual(vi, en);
  for (const lang of ['vi', 'en']) {
    for (const [k, v] of Object.entries(i18n.dict[lang])) assert.ok(typeof v === 'string' && v.length > 0, `${lang}.${k} is empty`);
  }
  assert.equal(i18n.lang, 'vi'); // Vietnamese is the default
});

test('every data-i18n key in web/*.html exists', () => {
  const { i18n } = loadWeb('i18n.js');
  assert.ok(htmlFiles.length >= 3);
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(WEB, file), 'utf8');
    for (const m of html.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)) {
      assert.ok(m[1] in i18n.dict.vi, `${file}: missing key ${m[1]}`);
    }
  }
});

test('every t("key") used by the scripts exists', () => {
  const { i18n } = loadWeb('i18n.js');
  for (const file of fs.readdirSync(path.join(WEB, 'js'))) {
    const src = fs.readFileSync(path.join(WEB, 'js', file), 'utf8');
    for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) assert.ok(m[1] in i18n.dict.vi, `${file}: missing key ${m[1]}`);
  }
});

test('create form rejects size outside 5..22 client side', () => {
  const { create } = loadWeb('create.js');
  const good = { rule: 'caro', w: '15', h: '12', games: '4', matchMinutes: '5', turnSeconds: '10', reconnectSec: '60', openingsText: '-\n-' };
  const ok = create.validate(good);
  assert.equal(ok.ok, true);
  assert.deepEqual(plain(ok.cfg), { rule: 'caro', w: 15, h: 12, games: 4, matchMs: 300000, turnMs: 10000, reconnectSec: 60, openingsText: '-\n-' });
  for (const bad of ['4', '23', '', 'x', '7.5', '-3']) {
    const r = create.validate({ ...good, w: bad });
    assert.equal(r.ok, false, `w=${bad}`);
    assert.equal(r.errors.w, 'create.errSize');
    assert.equal(create.validate({ ...good, h: bad }).errors.h, 'create.errSize');
  }
  assert.equal(create.validate({ ...good, w: '22', h: '5' }).ok, true);
});

test('create form checks the other fields and counts openings', () => {
  const { create } = loadWeb('create.js');
  const good = { rule: 'freestyle', w: '15', h: '15', games: '5', matchMinutes: '5', turnSeconds: '0', reconnectSec: '60', openingsText: '-\n\n7,7\n-\n' };
  assert.equal(create.validate(good).ok, true); // 3 openings for 5 games
  assert.equal(create.validate({ ...good, openingsText: '-\n-' }).errors.openings, 'create.errOpenings');
  assert.equal(create.validate({ ...good, games: '0' }).errors.games, 'create.errGames');
  assert.equal(create.validate({ ...good, matchMinutes: '0' }).errors.matchMinutes, 'create.errMatch');
  assert.equal(create.validate({ ...good, turnSeconds: '-1' }).errors.turnSeconds, 'create.errTurn');
  assert.equal(create.validate({ ...good, reconnectSec: '0' }).errors.reconnectSec, 'create.errReconnect');
  assert.equal(create.validate({ ...good, rule: 'renju' }).ok, false);
  assert.equal(create.needsRapfi({ rule: 'freestyle', w: 15, h: 15 }), false);
  assert.equal(create.needsRapfi({ rule: 'freestyle', w: 15, h: 12 }), true);
  assert.equal(create.needsRapfi({ rule: 'caro', w: 15, h: 15 }), true);
});

test('live model follows snapshot and events', () => {
  const { live } = loadWeb('live.js');
  const cfg = { rule: 'freestyle', w: 15, h: 15, games: 2, matchMs: 60000, turnMs: 0 };
  let m = live.reduce(null, { type: 'snapshot', snapshot: { state: 'waiting', cfg, players: { A: {}, B: {} }, score: { A: 0, B: 0, draws: 0 }, records: [], current: null } }, 1000);
  assert.equal(m.state, 'waiting');
  m = live.reduce(m, { type: 'event', event: { type: 'gameStart', gameIndex: 0, firstPlayer: 'A', opening: [{ x: 7, y: 7 }] } }, 2000);
  assert.deepEqual(plain(m.current.stones), [{ x: 7, y: 7, c: 1 }]);
  assert.equal(m.current.toMove, 'B');
  assert.equal(m.current.timeLeftMs.A, 60000);
  m = live.reduce(m, { type: 'event', event: { type: 'move', gameIndex: 0, ply: 1, player: 'B', x: 8, y: 8, elapsedMs: 500, timeLeftMs: { A: 60000, B: 59500 } } }, 3000);
  assert.deepEqual(plain(m.current.stones.at(-1)), { x: 8, y: 8, c: 2 });
  assert.equal(m.current.toMove, 'A');
  assert.equal(m.current.ply, 2);
  assert.equal(live.clockMs(m, 'A', 4000), 59000); // A's clock has been running for 1s since the move
  assert.equal(live.clockMs(m, 'B', 4000), 59500);
  const record = { gameIndex: 0, firstPlayer: 'A', opening: [{ x: 7, y: 7 }], moves: [{ ply: 1, player: 'B', x: 8, y: 8, elapsedMs: 500 }], result: { winner: 'B', reason: 'timeoutTurn' } };
  m = live.reduce(m, { type: 'event', event: { type: 'gameOver', gameIndex: 0, result: record.result, record, score: { A: 0, B: 1, draws: 0 } } }, 5000);
  assert.equal(m.current, null);
  assert.equal(m.records.length, 1);
  assert.deepEqual(plain(m.score), { A: 0, B: 1, draws: 0 });
  m = live.reduce(m, { type: 'event', event: { type: 'matchOver', score: { A: 0, B: 2, draws: 0 }, winner: 'B' } }, 6000);
  assert.equal(m.state, 'done');
  assert.equal(m.winner, 'B');
  assert.equal(live.reduce(m, { type: 'event', event: { type: 'nonsense' } }, 7000).state, 'done');
  assert.deepEqual(plain(live.positionAt(record, 2)), [{ x: 7, y: 7, c: 1 }, { x: 8, y: 8, c: 2 }]);
  assert.deepEqual(plain(live.positionAt(record, 1)), [{ x: 7, y: 7, c: 1 }]);
});

test('board geometry snaps cells to whole device pixels', () => {
  const { board } = loadWeb('board.js');
  for (const dpr of [1, 1.25, 1.5, 2, 3]) {
    const g = board.geometry({ w: 15, h: 12, availW: 700, availH: 520, dpr });
    assert.ok(Math.abs(g.cell * dpr - Math.round(g.cell * dpr)) < 1e-9, `cell ${g.cell} at dpr ${dpr}`);
    assert.ok(g.width <= 700 + 1e-6 && g.height <= 520 + 1e-6, 'fits the space');
    assert.ok(g.cell >= 20, 'not needlessly small');
  }
  assert.equal(board.label(0, 0, 15), 'A15');
  assert.equal(board.label(14, 14, 15), 'O1');
});

test('server serves every page and script', async () => {
  const srv = await startServer({ port: 0, dbPath: ':memory:' });
  try {
    const files = ['/', '/index.html', '/room.html', '/watch.html', '/css/style.css', ...fs.readdirSync(path.join(WEB, 'js')).map((f) => `/js/${f}`)];
    for (const f of files) {
      const res = await fetch(`http://127.0.0.1:${srv.port}${f}`);
      assert.equal(res.status, 200, f);
      await res.arrayBuffer();
    }
  } finally {
    await srv.close();
  }
});
