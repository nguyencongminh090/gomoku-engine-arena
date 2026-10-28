// Per-player match budget plus a per-move limit. Time runs from start() to stop(); the caller
// starts it when `go` is sent and stops it when the move arrives, so latency is the player's cost.
class Clock {
  constructor({ matchMs, turnMs, now = Date.now }) {
    this.matchMs = matchMs;
    this.turnMs = turnMs; // 0 = no per-move limit
    this.now = now;
    this.used = { A: 0, B: 0 };
    this.running = null; // { player, since }
  }

  start(player) {
    this.running = { player, since: this.now() };
  }

  stop() {
    if (!this.running) return { elapsedMs: 0 };
    const elapsedMs = this.now() - this.running.since;
    this.used[this.running.player] += elapsedMs;
    this.running = null;
    return { elapsedMs };
  }

  _spent(player) {
    const live = this.running && this.running.player === player ? this.now() - this.running.since : 0;
    return this.used[player] + live;
  }

  remaining(player) {
    return Math.max(0, this.matchMs - this._spent(player));
  }

  expired() {
    if (!this.running) return null;
    const { player, since } = this.running;
    if (this._spent(player) > this.matchMs) return 'match';
    if (this.turnMs > 0 && this.now() - since > this.turnMs) return 'turn';
    return null;
  }
}

module.exports = { Clock };
