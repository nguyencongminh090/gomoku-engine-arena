const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');

const room = { id: 'r1', ip: '1.1.1.1', cfg: { w: 15 }, hashA: 'a', hashB: 'b', hashSecret: 's', viewId: 'v1', createdAt: 1, lastActive: 1 };

test('saved game round-trips from db', () => {
  const db = openDb(':memory:');
  db.insertRoom(room);
  const game = {
    gameIndex: 0, firstPlayer: 'A', opening: [{ x: 7, y: 7 }],
    moves: [{ ply: 1, player: 'B', x: 8, y: 8, elapsedMs: 120 }, { ply: 2, player: 'A', x: 6, y: 6, elapsedMs: 340 }],
    result: { winner: 'A', reason: 'five' },
  };
  db.saveGame('r1', game);
  assert.deepEqual(db.loadMatch('r1'), { games: [game] });
});

test('saveGame replaces an earlier save of the same game, drawn result keeps null winner', () => {
  const db = openDb(':memory:');
  db.insertRoom(room);
  db.saveGame('r1', { gameIndex: 1, firstPlayer: 'B', opening: [], moves: [{ ply: 0, player: 'B', x: 1, y: 1, elapsedMs: 5 }], result: { winner: 'A', reason: 'timeoutTurn' } });
  const g = { gameIndex: 1, firstPlayer: 'B', opening: [], moves: [], result: { winner: null, reason: 'full' } };
  db.saveGame('r1', g);
  assert.deepEqual(db.loadMatch('r1').games, [g]);
});

test('games come back ordered and deleting a room removes its games', () => {
  const db = openDb(':memory:');
  db.insertRoom(room);
  const mk = (i) => ({ gameIndex: i, firstPlayer: 'A', opening: [], moves: [], result: { winner: null, reason: 'full' } });
  db.saveGame('r1', mk(2)); db.saveGame('r1', mk(0));
  assert.deepEqual(db.loadMatch('r1').games.map((g) => g.gameIndex), [0, 2]);
  db.deleteRoom('r1');
  assert.deepEqual(db.loadMatch('r1'), { games: [] });
  assert.deepEqual(db.allRooms(), []);
});

test('room rows round-trip', () => {
  const db = openDb(':memory:');
  db.insertRoom(room);
  db.touchRoom('r1', 99);
  assert.deepEqual(db.allRooms(), [{ ...room, lastActive: 99 }]);
});
