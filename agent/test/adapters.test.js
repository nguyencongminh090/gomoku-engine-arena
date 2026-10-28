const test = require('node:test');
const assert = require('node:assert/strict');
const rapfi = require('../src/adapters/rapfi');
const gomocup = require('../src/adapters/gomocup');

const cfg = { rule: 'caro', w: 15, h: 12, matchMs: 100000, turnMs: 5000 };

test('rapfi configure: rect board, rule id and clocks', () => {
  assert.deepEqual(rapfi.configure(cfg), ['RECTSTART 15,12', 'INFO RULE 8', 'INFO TIMEOUT_MATCH 100000', 'INFO TIMEOUT_TURN 5000']);
  assert.deepEqual(rapfi.configure({ ...cfg, w: 15, h: 15, rule: 'standard', turnMs: 0 }),
    ['START 15', 'INFO RULE 1', 'INFO TIMEOUT_MATCH 100000', 'INFO TIMEOUT_TURN 2147483647']);
});

test('rapfi beginSearch: empty board uses BEGIN, otherwise a full BOARD block with absolute colours', () => {
  assert.deepEqual(rapfi.beginSearch({ stones: [], toMove: 1, timeLeftMs: 5000, turnMs: 0, w: 15, h: 15 }),
    ['RESTART', 'INFO TIME_LEFT 5000', 'BEGIN']);
  const stones = [{ x: 7, y: 7, c: 1 }, { x: 8, y: 8, c: 2 }, { x: 6, y: 6, c: 1 }];
  assert.deepEqual(rapfi.beginSearch({ stones, toMove: 2, timeLeftMs: 5000, turnMs: 0, w: 15, h: 15 }),
    ['INFO TIME_LEFT 5000', 'BOARD', '7,7,1', '8,8,2', '6,6,1', 'DONE']);
});

test('gomocup beginSearch: colours are relative to the side to move (1 own, 2 opponent)', () => {
  const stones = [{ x: 7, y: 7, c: 1 }, { x: 8, y: 8, c: 2 }, { x: 6, y: 6, c: 1 }];
  assert.deepEqual(gomocup.beginSearch({ stones, toMove: 2, timeLeftMs: 5000, turnMs: 0, w: 15, h: 15 }),
    ['INFO time_left 5000', 'BOARD', '7,7,2', '8,8,1', '6,6,2', 'DONE']);
  assert.deepEqual(gomocup.beginSearch({ stones: [], toMove: 1, timeLeftMs: 5000, turnMs: 0, w: 15, h: 15 }),
    ['INFO time_left 5000', 'BEGIN']);
});

test('gomocup configure uses START n and Gomocup INFO keys', () => {
  assert.deepEqual(gomocup.configure({ rule: 'freestyle', w: 15, h: 15, matchMs: 1000, turnMs: 100 }),
    ['START 15', 'INFO timeout_match 1000', 'INFO timeout_turn 100', 'INFO rule 0']);
});

test('parseLine understands moves, errors, ok and progress text', () => {
  for (const a of [rapfi, gomocup]) {
    assert.deepEqual(a.parseLine('12,3'), { type: 'move', x: 12, y: 3 });
    assert.deepEqual(a.parseLine(' 0,0 '), { type: 'move', x: 0, y: 0 });
    assert.deepEqual(a.parseLine('ERROR bad thing'), { type: 'error', text: 'bad thing' });
    assert.deepEqual(a.parseLine('OK'), { type: 'ok' });
    assert.deepEqual(a.parseLine('MESSAGE depth 5'), { type: 'info', data: { text: 'depth 5' } });
    assert.equal(a.parseLine(''), null);
    assert.equal(a.parseLine('UNKNOWN foo'), null);
    assert.equal(a.stopCommand(), 'YXSTOP');
  }
});
