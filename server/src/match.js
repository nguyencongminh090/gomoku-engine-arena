const P = require('./protocol');
const { GameState } = require('./game');

const other = (p) => (p === 'A' ? 'B' : 'A');
const PLAYERS = ['A', 'B'];

// Lifecycle of one room's match: waiting -> (playing <-> between)* -> done.
// Pure of I/O: the server injects `send(player, text)`, `onEvent(event)` and a clock; tick() must be called regularly.
class Match {
  constructor({ cfg, schedule, now = Date.now, send, onEvent = () => {}, completed = [] }) {
    this.cfg = cfg;
    this.schedule = schedule;
    this.now = now;
    this.sendFn = send;
    this.emit = onEvent;
    this.records = completed.slice();
    this.started = completed.length > 0;
    this.state = 'waiting';
    this.game = null;
    this.gameIndex = -1;
    this.reconnectMs = cfg.reconnectSec * 1000;
    this.players = {};
    for (const p of PLAYERS) this.players[p] = { connected: false, ready: false, engine: null, limits: null, reason: null, since: now() };
    if (this.records.length >= schedule.length) this._endMatch();
  }

  _present(p) { return this.players[p].connected && this.players[p].ready; }

  _send(p, text) { if (this.players[p].connected) this.sendFn(p, text); }

  _score() {
    const score = { A: 0, B: 0, draws: 0 };
    for (const r of this.records) {
      if (r.result.winner === null) score.draws++;
      else score[r.result.winner]++;
    }
    return score;
  }

  _status() {
    const players = {};
    for (const p of PLAYERS) {
      const s = this.players[p];
      players[p] = { connected: s.connected, ready: s.ready, engine: s.engine ? s.engine.name : null, reason: s.reason };
    }
    return players;
  }

  _emitStatus() { this.emit({ type: 'status', state: this.state, players: this._status() }); }

  snapshot() {
    const g = this.game;
    return {
      state: this.state,
      cfg: { rule: this.cfg.rule, w: this.cfg.w, h: this.cfg.h, games: this.cfg.games, matchMs: this.cfg.matchMs, turnMs: this.cfg.turnMs },
      players: this._status(),
      score: this._score(),
      records: this.records,
      current: g && {
        gameIndex: this.gameIndex,
        firstPlayer: g.firstPlayer,
        ply: g.ply,
        toMove: g.toMove,
        stones: g.stones(),
        moves: g.moveLog,
        timeLeftMs: { A: g.timeLeftMs('A'), B: g.timeLeftMs('B') },
      },
    };
  }

  // The server re-checks what the agent claimed; a refusal here is only visible in status events.
  _refusal(hello) {
    const { w, h, rule } = this.cfg;
    if (!hello) return 'no hello';
    if (hello.engine.kind === 'unknown') return 'engine type not recognised';
    if (w > hello.limits.maxW || h > hello.limits.maxH) return `board ${w}x${h} exceeds engine limit ${hello.limits.maxW}x${hello.limits.maxH}`;
    if (hello.engine.kind === 'classic' && (w !== h || rule !== 'freestyle')) return 'classic engine supports only square freestyle boards';
    return null;
  }

  agentConnected(player, hello) {
    const s = this.players[player];
    if (!s || this.state === 'done') return;
    s.connected = true;
    s.ready = false;
    s.hello = hello;
    s.engine = hello.engine;
    s.limits = hello.limits;
    s.reason = null;
    s.since = this.now();
    const { rule, w, h, matchMs, turnMs } = this.cfg;
    this.sendFn(player, P.config({ rule, w, h, matchMs, turnMs }));
    this._emitStatus();
  }

  agentDisconnected(player) {
    const s = this.players[player];
    if (!s || !s.connected) return;
    s.connected = false;
    s.ready = false;
    s.since = this.now();
    this._emitStatus();
  }

  agentMessage(player, msg) {
    const s = this.players[player];
    if (!s || this.state === 'done' || !s.connected) return;
    switch (msg.type) {
      case 'ready': return this._onReady(player, msg);
      case 'move': return this._onMove(player, msg);
      case 'info': return this.emit({ type: 'info', player, data: msg.data });
      case 'log': return this.emit({ type: 'log', player, level: msg.level, text: msg.text });
      default: return undefined;
    }
  }

  _onReady(player, msg) {
    const s = this.players[player];
    const reason = msg.ok ? this._refusal(s.hello) : (msg.reason || 'refused');
    s.ready = reason === null;
    s.reason = reason;
    if (!s.ready) s.since = this.now();
    this._emitStatus();
    if (!s.ready) return;
    if (this.state === 'playing' && this.game.toMove === player) this._sendGo();
    else this._advance();
  }

  _onMove(player, msg) {
    if (this.state !== 'playing' || msg.gameId !== this.gameIndex || !this._present(player)) return;
    const g = this.game;
    const r = g.submit(player, msg.ply, msg.x, msg.y);
    if (!r.ok) {
      if (r.result) this._finishGame(r.result);
      return;
    }
    const last = g.moveLog.at(-1);
    this.emit({
      type: 'move', gameIndex: this.gameIndex, ply: last.ply, player, x: last.x, y: last.y,
      elapsedMs: last.elapsedMs, timeLeftMs: { A: g.timeLeftMs('A'), B: g.timeLeftMs('B') },
    });
    if (r.result) this._finishGame(r.result);
    else this._sendGo();
  }

  _sendGo() {
    const g = this.game;
    const mover = g.toMove;
    if (!this._present(mover)) return;
    this._send(mover, P.go({
      gameId: this.gameIndex, ply: g.ply, stones: g.stones(), toMove: (g.ply % 2) + 1,
      timeLeftMs: g.timeLeftMs(mover), turnMs: this.cfg.turnMs,
    }));
  }

  _startGame(entry) {
    const { rule, w, h, matchMs, turnMs } = this.cfg;
    this.gameIndex = entry.gameIndex;
    this.state = 'playing';
    this.game = new GameState({ w, h, rule, opening: entry.opening, firstPlayer: entry.firstPlayer, matchMs, turnMs, now: this.now });
    this.emit({ type: 'gameStart', gameIndex: entry.gameIndex, firstPlayer: entry.firstPlayer, opening: entry.opening });
    this._sendGo();
  }

  _record(entry, moves, result) {
    const record = { gameIndex: entry.gameIndex, firstPlayer: entry.firstPlayer, opening: entry.opening, moves, result };
    this.records.push(record);
    this.emit({ type: 'gameOver', gameIndex: entry.gameIndex, result, record, score: this._score() });
    for (const p of PLAYERS) this._send(p, P.gameOver({ gameId: entry.gameIndex, result }));
  }

  _finishGame(result) {
    const entry = this.schedule[this.gameIndex];
    const moves = this.game.moveLog;
    this.game = null;
    this.state = 'between';
    this._record(entry, moves, result);
    this._advance();
  }

  _endMatch() {
    this.state = 'done';
    this.game = null;
    const score = this._score();
    const winner = score.A === score.B ? null : score.A > score.B ? 'A' : 'B';
    this.emit({ type: 'matchOver', score, winner });
  }

  _gone(p) { return !this._present(p) && this.now() - this.players[p].since > this.reconnectMs; }

  // Starts the next game when both players are ready, or settles absences once their window has run out.
  _advance() {
    while (this.state === 'waiting' || this.state === 'between') {
      if (this.records.length >= this.schedule.length) return this._endMatch();
      const entry = this.schedule[this.records.length];
      if (this._present('A') && this._present('B')) {
        this.started = true;
        return this._startGame(entry);
      }
      if (!this.started) return undefined; // nobody has played yet; the room's own expiry covers no-shows
      const goneA = this._gone('A');
      const goneB = this._gone('B');
      if (goneA && goneB) return this._endMatch();
      if (!goneA && !goneB) return undefined;
      this._record(entry, [], { winner: other(goneA ? 'A' : 'B'), reason: 'absent' });
    }
    return undefined;
  }

  tick() {
    if (this.state === 'playing') {
      const timed = this.game.timeout();
      if (timed) return this._finishGame(timed);
      const goneA = this._gone('A');
      const goneB = this._gone('B');
      if (goneA && goneB) return this._finishGame({ winner: null, reason: 'absent' }); // game is void, nobody wins it
      if (goneA || goneB) {
        const p = goneA ? 'A' : 'B';
        return this._finishGame(this.game.forfeit(p, 'disconnect'));
      }
      return undefined;
    }
    return this._advance();
  }
}

module.exports = { Match };
