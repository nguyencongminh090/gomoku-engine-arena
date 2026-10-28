const test = require('node:test');
const assert = require('node:assert/strict');
const { Match } = require('../src/match');
const { normalizeConfig } = require('../src/rooms');

function setup(over = {}, matchOpts = {}) {
  const { cfg, schedule } = normalizeConfig({
    rule: 'freestyle', w: 15, h: 15, games: 2, matchMs: 600000, turnMs: 0, reconnectSec: 60,
    openingsText: '-\n-', ...over,
  });
  const t = { v: 1_000_000, now: () => t.v };
  const sent = { A: [], B: [] };
  const events = [];
  const match = new Match({
    cfg, schedule, now: t.now,
    send: (p, text) => sent[p].push(JSON.parse(text)),
    onEvent: (e) => events.push(e),
    ...matchOpts,
  });
  return { t, sent, events, match };
}

const hello = (kind = 'rapfi') => ({ type: 'hello', token: 'x', engine: { name: 'E', version: '1', kind }, limits: { maxW: 22, maxH: 22 } });
const connect = (m, p) => { m.agentConnected(p, hello()); m.agentMessage(p, { type: 'ready', ok: true }); };
const goes = (sent, p) => sent[p].filter((x) => x.type === 'go');
const of = (events, type) => events.filter((e) => e.type === type);
const other = (p) => (p === 'A' ? 'B' : 'A');

// Plays the current game until `winner` has five in a row. Winner uses row 0, loser scattered cells.
function playOut(match, winner) {
  const gameId = match.snapshot().current.gameIndex;
  let wi = 0, li = 0;
  for (let guard = 0; guard < 100; guard++) {
    const cur = match.snapshot().current;
    if (!cur || cur.gameIndex !== gameId) return;
    const mover = cur.toMove;
    const cell = mover === winner ? { x: wi++, y: 0 } : { x: 2 * li, y: 10 + (li++ % 2) };
    match.agentMessage(mover, { type: 'move', gameId, ply: cur.ply, ...cell });
  }
  throw new Error('game did not finish');
}

test('starts only after both ready', () => {
  const { match, sent } = setup();
  match.agentConnected('A', hello());
  match.agentMessage('A', { type: 'ready', ok: true });
  assert.equal(sent.A.filter((x) => x.type === 'config').length, 1);
  assert.equal(goes(sent, 'A').length, 0);
  match.agentConnected('B', hello());
  assert.equal(goes(sent, 'A').length, 0);
  match.agentMessage('B', { type: 'ready', ok: true });
  assert.equal(goes(sent, 'B').length, 0);
  const go = goes(sent, 'A');
  assert.equal(go.length, 1);
  assert.deepEqual(go[0], { type: 'go', gameId: 0, ply: 0, stones: [], toMove: 1, timeLeftMs: 600000, turnMs: 0 });
});

test('plays all games with swapped sides', () => {
  const { match, sent, events } = setup();
  connect(match, 'A'); connect(match, 'B');
  playOut(match, 'A');
  assert.equal(goes(sent, 'B').length > 0, true); // game 1: B moves first
  assert.equal(match.snapshot().current.firstPlayer, 'B');
  playOut(match, 'B');
  const over = of(events, 'gameOver');
  assert.deepEqual(over.map((e) => e.result), [{ winner: 'A', reason: 'five' }, { winner: 'B', reason: 'five' }]);
  assert.deepEqual(of(events, 'matchOver'), [{ type: 'matchOver', score: { A: 1, B: 1, draws: 0 }, winner: null }]);
  assert.equal(sent.A.filter((x) => x.type === 'gameOver').length, 2);
  assert.equal(match.snapshot().state, 'done');
  assert.equal(over[0].record.moves.length, 9);
  assert.deepEqual(over[0].record.moves[0], { ply: 0, player: 'A', x: 0, y: 0, elapsedMs: 0 });
});

test('ready not ok rejects with reason', () => {
  const { match, sent, events } = setup();
  connect(match, 'B');
  match.agentConnected('A', hello('classic'));
  match.agentMessage('A', { type: 'ready', ok: false, reason: 'rule not supported' });
  assert.equal(goes(sent, 'B').length + goes(sent, 'A').length, 0);
  assert.equal(match.snapshot().players.A.reason, 'rule not supported');
  assert.equal(of(events, 'status').at(-1).players.A.ready, false);
  match.agentConnected('A', hello()); // fixed engine
  match.agentMessage('A', { type: 'ready', ok: true });
  assert.equal(goes(sent, 'A').length, 1);
  assert.equal(match.snapshot().players.A.reason, null);
});

test('server refuses ready ok from an engine whose limits or kind do not fit', () => {
  const { match, sent } = setup({ w: 15, h: 12 });
  match.agentConnected('A', { ...hello(), limits: { maxW: 10, maxH: 22 } });
  match.agentMessage('A', { type: 'ready', ok: true });
  assert.match(match.snapshot().players.A.reason, /limit/);
  match.agentConnected('B', hello('classic')); // rectangular board
  match.agentMessage('B', { type: 'ready', ok: true });
  assert.match(match.snapshot().players.B.reason, /classic/);
  assert.equal(goes(sent, 'A').length + goes(sent, 'B').length, 0);
});

test('illegal, stale and foreign moves are ignored and the game continues', () => {
  const { match } = setup();
  connect(match, 'A'); connect(match, 'B');
  match.agentMessage('A', { type: 'move', gameId: 0, ply: 0, x: 5, y: 5 });
  assert.equal(match.snapshot().current.ply, 1);
  match.agentMessage('A', { type: 'move', gameId: 0, ply: 1, x: 6, y: 6 }); // not A's turn
  match.agentMessage('B', { type: 'move', gameId: 0, ply: 1, x: 5, y: 5 }); // occupied
  match.agentMessage('B', { type: 'move', gameId: 0, ply: 7, x: 6, y: 6 }); // bad ply
  match.agentMessage('B', { type: 'move', gameId: 9, ply: 1, x: 6, y: 6 }); // other game
  match.agentMessage('B', { type: 'move', gameId: 0, ply: 1, x: 99, y: 6 }); // off board
  match.agentMessage('C', { type: 'move', gameId: 0, ply: 1, x: 6, y: 6 }); // not a player
  assert.equal(match.snapshot().current.ply, 1);
  match.agentMessage('B', { type: 'move', gameId: 0, ply: 1, x: 6, y: 6 });
  assert.equal(match.snapshot().current.ply, 2);
});

test('late move after gameOver is ignored', () => {
  const { match, events } = setup();
  connect(match, 'A'); connect(match, 'B');
  playOut(match, 'A');
  const before = events.length;
  match.agentMessage('B', { type: 'move', gameId: 0, ply: 9, x: 1, y: 1 });
  match.agentMessage('A', { type: 'move', gameId: 0, ply: 9, x: 1, y: 1 });
  assert.equal(events.length, before);
  assert.equal(match.snapshot().current.ply, 0); // game 1 untouched
});

test('turn timeout ends the game via tick', () => {
  const { match, t, events, sent } = setup({ turnMs: 1000 });
  connect(match, 'A'); connect(match, 'B');
  t.v += 999; match.tick();
  assert.equal(of(events, 'gameOver').length, 0);
  t.v += 2; match.tick();
  assert.deepEqual(of(events, 'gameOver')[0].result, { winner: 'B', reason: 'timeoutTurn' });
  assert.equal(sent.A.some((x) => x.type === 'gameOver'), true); // tells A's engine to stop
  assert.equal(match.snapshot().current.gameIndex, 1); // next game started
});

test('disconnect then reconnect within window resumes with go and current time left', () => {
  const { match, t, sent } = setup();
  connect(match, 'A'); connect(match, 'B');
  t.v += 3000;
  match.agentDisconnected('A');
  t.v += 10000;
  match.tick();
  assert.equal(match.snapshot().state, 'playing');
  const before = goes(sent, 'A').length;
  match.agentConnected('A', hello());
  assert.equal(sent.A.at(-1).type, 'config');
  match.agentMessage('A', { type: 'ready', ok: true });
  const go = goes(sent, 'A');
  assert.equal(go.length, before + 1);
  assert.equal(go.at(-1).timeLeftMs, 600000 - 13000);
  assert.equal(go.at(-1).ply, 0);
});

test('window expiry forfeits, and a player who stays away loses the remaining games', () => {
  const { match, t, events } = setup();
  connect(match, 'A'); connect(match, 'B');
  match.agentDisconnected('A');
  t.v += 59000; match.tick();
  assert.equal(of(events, 'gameOver').length, 0);
  t.v += 2000; match.tick();
  const over = of(events, 'gameOver');
  assert.deepEqual(over[0].result, { winner: 'B', reason: 'disconnect' });
  assert.deepEqual(over[1].result, { winner: 'B', reason: 'absent' });
  assert.deepEqual(of(events, 'matchOver')[0], { type: 'matchOver', score: { A: 0, B: 2, draws: 0 }, winner: 'B' });
});

test('both players absent ends match; leader wins', () => {
  const { match, t, events } = setup({ games: 4, openingsText: '-\n-' });
  connect(match, 'A'); connect(match, 'B');
  playOut(match, 'A');
  match.agentDisconnected('A'); match.agentDisconnected('B');
  t.v += 61000; match.tick();
  assert.deepEqual(of(events, 'matchOver'), [{ type: 'matchOver', score: { A: 1, B: 0, draws: 1 }, winner: 'A' }]);
  assert.deepEqual(of(events, 'gameOver').at(-1).result, { winner: null, reason: 'absent' });
  assert.equal(match.snapshot().state, 'done');
});

test('both absent from the start of a resumed match: tie ends as draw', () => {
  const { match, t, events } = setup({ games: 2 }, {
    completed: [
      { gameIndex: 0, firstPlayer: 'A', opening: [], moves: [], result: { winner: 'A', reason: 'five' } },
    ],
  });
  assert.equal(match.snapshot().score.A, 1);
  t.v += 61000; match.tick();
  // Nobody ever came back: game 1 is void for both, the leader takes the match.
  assert.deepEqual(of(events, 'matchOver')[0].winner, 'A');
});

test('absent between games forfeits that game', () => {
  const { match, t, events } = setup({ games: 3, openingsText: '-\n-' }, {
    completed: [
      { gameIndex: 0, firstPlayer: 'A', opening: [], moves: [], result: { winner: 'B', reason: 'five' } },
    ],
  });
  connect(match, 'A'); // B never shows up
  t.v += 30000; match.tick();
  assert.equal(of(events, 'gameOver').length, 0);
  t.v += 31000; match.tick();
  const over = of(events, 'gameOver');
  assert.deepEqual(over.map((e) => [e.gameIndex, e.result]), [
    [1, { winner: 'A', reason: 'absent' }],
    [2, { winner: 'A', reason: 'absent' }],
  ]);
  assert.equal(of(events, 'matchOver')[0].score.A, 2);
});

test('odd games last opening single game', () => {
  const { match, events, sent } = setup({ games: 3, openingsText: '-\n0,14' });
  connect(match, 'A'); connect(match, 'B');
  playOut(match, 'A');
  playOut(match, 'B');
  const go = goes(sent, 'B').at(-1); // game 2: A first with one opening stone, so B to move
  assert.deepEqual(go.stones, [{ x: 0, y: 14, c: 1 }]);
  assert.equal(go.gameId, 2);
  assert.equal(go.toMove, 2);
  playOut(match, 'A');
  assert.equal(of(events, 'gameOver').length, 3);
  assert.deepEqual(of(events, 'matchOver')[0].score, { A: 2, B: 1, draws: 0 });
});

test('a reconnecting agent that is not the mover gets no go but the position stays correct', () => {
  const { match, sent } = setup();
  connect(match, 'A'); connect(match, 'B');
  match.agentDisconnected('B');
  match.agentConnected('B', hello());
  match.agentMessage('B', { type: 'ready', ok: true });
  assert.equal(goes(sent, 'B').length, 0); // A is to move
  match.agentMessage('A', { type: 'move', gameId: 0, ply: 0, x: 3, y: 3 });
  assert.equal(goes(sent, 'B').length, 1);
  assert.deepEqual(goes(sent, 'B')[0].stones, [{ x: 3, y: 3, c: 1 }]);
});

test('info and log from agents are forwarded as events', () => {
  const { match, events } = setup();
  connect(match, 'A');
  match.agentMessage('A', { type: 'info', data: { depth: 7 } });
  match.agentMessage('A', { type: 'log', level: 'info', text: 'hi' });
  assert.deepEqual(of(events, 'info')[0], { type: 'info', player: 'A', data: { depth: 7 } });
  assert.deepEqual(of(events, 'log')[0], { type: 'log', player: 'A', level: 'info', text: 'hi' });
});

test('reconnecting without ready, or being refused repeatedly, does not extend the absence window', () => {
  const { match, t, events } = setup();
  connect(match, 'A'); connect(match, 'B');
  match.agentDisconnected('A');
  for (let i = 0; i < 5; i++) {
    t.v += 15000;
    match.agentConnected('A', hello()); // connects but never says ready
    match.agentMessage('A', { type: 'ready', ok: false, reason: 'nope' });
    match.agentDisconnected('A');
  }
  t.v += 1000; // 76s since A first left
  match.tick();
  assert.deepEqual(of(events, 'gameOver')[0].result, { winner: 'B', reason: 'disconnect' });
});

test('snapshot of a finished match carries its winner, so late viewers do not see a draw', () => {
  const { match } = setup();
  connect(match, 'A'); connect(match, 'B');
  assert.equal(match.snapshot().winner, undefined); // nothing decided yet
  playOut(match, 'A');
  playOut(match, 'A'); // game 1: B moves first but A wins again
  const snap = match.snapshot();
  assert.equal(snap.state, 'done');
  assert.equal(snap.winner, 'A');
  const { match: draw } = setup();
  connect(draw, 'A'); connect(draw, 'B');
  playOut(draw, 'A'); playOut(draw, 'B');
  assert.equal(draw.snapshot().winner, null);
});

test('go carries the remaining turn time after a mid-turn reconnect', () => {
  const { match, t, sent } = setup({ turnMs: 10000 });
  connect(match, 'A'); connect(match, 'B');
  assert.equal(goes(sent, 'A').at(-1).turnMs, 10000);
  t.v += 3000;
  match.agentDisconnected('A');
  t.v += 5000; // 8s into the 10s move
  match.agentConnected('A', hello());
  match.agentMessage('A', { type: 'ready', ok: true });
  assert.equal(goes(sent, 'A').at(-1).turnMs, 2000);
});

test('a move is never sent a turn budget below one millisecond and unlimited stays 0', () => {
  const a = setup({ turnMs: 10000 });
  connect(a.match, 'A'); connect(a.match, 'B');
  a.t.v += 9999;
  a.match.agentDisconnected('A');
  a.match.agentConnected('A', hello());
  a.match.agentMessage('A', { type: 'ready', ok: true });
  assert.equal(goes(a.sent, 'A').at(-1).turnMs, 1);
  const b = setup({ turnMs: 0 });
  connect(b.match, 'A'); connect(b.match, 'B');
  assert.equal(goes(b.sent, 'A').at(-1).turnMs, 0);
});

test('refusals expose a code and args for the UI, and agent-supplied codes pass through', () => {
  const { match } = setup({ w: 15, h: 12 });
  match.agentConnected('A', { ...hello(), limits: { maxW: 10, maxH: 22 } });
  match.agentMessage('A', { type: 'ready', ok: true });
  const a = match.snapshot().players.A;
  assert.equal(a.reasonCode, 'boardLimit');
  assert.deepEqual(a.reasonArgs, { w: 15, h: 12, maxW: 10, maxH: 22 });
  match.agentConnected('B', hello('classic'));
  match.agentMessage('B', { type: 'ready', ok: true });
  assert.equal(match.snapshot().players.B.reasonCode, 'classicSquareOnly');
  match.agentConnected('B', hello());
  match.agentMessage('B', { type: 'ready', ok: false, reason: 'engine rejected "INFO RULE 8": nope', code: 'engineRejected', args: { command: 'INFO RULE 8', error: 'nope' } });
  const b = match.snapshot().players.B;
  assert.deepEqual([b.reasonCode, b.reasonArgs.command], ['engineRejected', 'INFO RULE 8']);
  match.agentMessage('B', { type: 'ready', ok: false, reason: 'free text only' });
  assert.equal(match.snapshot().players.B.reasonCode, null);
  assert.equal(match.snapshot().players.B.reason, 'free text only');
});
