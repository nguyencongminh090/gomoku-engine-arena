const { Board } = require('./board');
const { checkWin } = require('./rules');
const { Clock } = require('./clock');

const other = (p) => (p === 'A' ? 'B' : 'A');

// One game. firstPlayer owns colour 1 and moves first; opening stones alternate colours from 1
// and count towards ply, so the player to move after k opening stones is firstPlayer when k is even.
class GameState {
  constructor({ w, h, rule, opening = [], firstPlayer, matchMs, turnMs, now = Date.now }) {
    this.rule = rule;
    this.board = new Board(w, h);
    this.firstPlayer = firstPlayer;
    this.list = [];
    for (const { x, y } of opening) this._place(x, y);
    this.clock = new Clock({ matchMs, turnMs, now });
    this.result = null;
    this.clock.start(this.toMove);
  }

  get ply() { return this.list.length; }
  get toMove() { return this.ply % 2 === 0 ? this.firstPlayer : other(this.firstPlayer); }
  get over() { return this.result !== null; }

  _place(x, y) {
    const c = (this.list.length % 2) + 1;
    this.board.set(x, y, c);
    this.list.push({ x, y, c });
  }

  stones() { return this.list.map((s) => ({ ...s })); }

  timeLeftMs(player) { return this.clock.remaining(player); }

  _finish(result) {
    this.clock.stop();
    this.result = result;
    return result;
  }

  submit(player, ply, x, y) {
    if (this.over) return { ok: false, reason: 'over' };
    const late = this.timeout();
    if (late) return { ok: false, reason: 'over', result: late };
    if (player !== this.toMove) return { ok: false, reason: 'notYourTurn' };
    if (ply !== this.ply) return { ok: false, reason: 'badPly' };
    if (!this.board.inBounds(x, y)) return { ok: false, reason: 'range' };
    if (this.board.get(x, y) !== 0) return { ok: false, reason: 'occupied' };
    this.clock.stop();
    this._place(x, y);
    if (checkWin(this.board, x, y, this.rule)) return { ok: true, result: this._finish({ winner: player, reason: 'five' }) };
    if (this.board.isFull()) return { ok: true, result: this._finish({ winner: null, reason: 'full' }) };
    this.clock.start(this.toMove);
    return { ok: true };
  }

  timeout() {
    if (this.over) return this.result;
    const why = this.clock.expired();
    if (!why) return null;
    return this._finish({ winner: other(this.toMove), reason: why === 'turn' ? 'timeoutTurn' : 'timeoutMatch' });
  }

  forfeit(player, reason) {
    if (this.over) return this.result;
    return this._finish({ winner: other(player), reason });
  }
}

module.exports = { GameState };
