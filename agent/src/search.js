const { EventEmitter } = require('node:events');

// Strict one-search-at-a-time state machine over an engine process: idle -> searching -> idle, or
// searching -> aborting -> idle. After STOP the engine owes exactly one move line; abort() does not return
// until it has been swallowed (or the engine was restarted), so a stale answer can never be taken for the next search.
class SearchSession extends EventEmitter {
  constructor(proc, adapter, { graceMs = 3000 } = {}) {
    super();
    this.proc = proc;
    this.adapter = adapter;
    this.graceMs = graceMs;
    this.cfg = null;
    this.state = 'idle';
    this.pending = null;
    this.abortDone = null;
    this.graceTimer = null;
    proc.on('line', (line) => this._onLine(line));
    proc.on('restart', () => this._init());
    proc.on('exit', (code) => this._onExit(code));
  }

  configure(cfg) {
    this.cfg = cfg;
    this._init();
  }

  _init() {
    if (!this.cfg) return;
    for (const line of [...this.adapter.start(), ...this.adapter.configure(this.cfg)]) this.proc.write(line);
  }

  search(req) {
    if (this.state !== 'idle') return Promise.reject(Object.assign(new Error('a search is already running'), { code: 'busy' }));
    if (!this.proc.running) this.proc.restart(); // restart() re-sends the configuration
    this.state = 'searching';
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      for (const line of this.adapter.beginSearch(req)) this.proc.write(line);
    });
  }

  abort() {
    if (this.state === 'idle') return Promise.resolve();
    if (this.state === 'aborting') return this.abortPromise;
    this.state = 'aborting';
    this._settle(null); // the aborted search's answer is discarded
    this.abortPromise = new Promise((resolve) => {
      this.abortDone = resolve;
      this.graceTimer = setTimeout(() => {
        this._idle();
        this.proc.restart();
      }, this.graceMs);
    });
    const stop = this.adapter.stopCommand();
    if (stop) this.proc.write(stop);
    return this.abortPromise;
  }

  _settle(value, err) {
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    if (err) p.reject(err); else p.resolve(value);
  }

  _idle() {
    this.state = 'idle';
    clearTimeout(this.graceTimer);
    this.graceTimer = null;
    const done = this.abortDone;
    this.abortDone = null;
    this.abortPromise = null;
    if (done) done();
  }

  _onLine(line) {
    const msg = this.adapter.parseLine(line);
    if (!msg) return;
    if (msg.type === 'info') this.emit('info', msg.data);
    else if (msg.type === 'error') this.emit('engineError', msg.text);
    else if (msg.type === 'move') this._onMove(msg);
  }

  _onMove({ x, y }) {
    if (this.state === 'searching') {
      this.state = 'idle';
      this._settle({ x, y });
    } else if (this.state === 'aborting') {
      this._idle(); // the one owed move line; discard it
    } else {
      this.emit('stray', { x, y }); // unsolicited line while idle
    }
  }

  _onExit(code) {
    if (this.state === 'searching') {
      this.state = 'idle';
      this._settle(null, new Error(`engine exited during search (${code})`));
    } else if (this.state === 'aborting') {
      this._idle();
    }
  }
}

module.exports = { SearchSession };
