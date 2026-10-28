const { EventEmitter } = require('node:events');
const WebSocket = require('ws');
const P = require('../../server/src/protocol');
const { EngineProcess } = require('./engine-process');
const { SearchSession } = require('./search');
const { detectEngine, checkConfig, probeConfigure } = require('./detect');
const rapfi = require('./adapters/rapfi');
const gomocup = require('./adapters/gomocup');

const FATAL_CLOSE = { 4401: 'bad token', 4410: 'room closed', 4000: 'replaced by another agent' };
const MAX_BACKOFF_MS = 5000;
const INFO_INTERVAL_MS = 250; // the server allows 20 messages per second

// Runs a local engine and plays whatever the server asks of it. The server is the referee; this side only
// answers `go` with one move and aborts on `stop`/`gameOver`.
class Agent extends EventEmitter {
  // marginMs is shaved off both budgets: the server charges network latency to the player, so the engine must
  // finish a little before the server's limit.
  constructor({ enginePath, token, serverUrl, engineEnv, reconnectMs = 1000, graceMs, marginMs = 150 }) {
    super();
    this.token = token;
    this.serverUrl = serverUrl;
    this.reconnectMs = reconnectMs;
    this.marginMs = marginMs;
    this.engine = new EngineProcess(enginePath, engineEnv ? { env: engineEnv } : {});
    this.graceMs = graceMs;
    this.ws = null;
    this.stopped = false;
    this.fatal = null;
    this.info = null;
    this.adapter = null;
    this.session = null;
    this.cfg = null; // set once the engine accepted a config
    this.gen = 0; // bumps whenever the current search must be forgotten
    this.backoff = reconnectMs;
    this.lastInfoAt = 0;
  }

  async start() {
    this.engine.start();
    this.engine.on('stderr', (line) => this.emit('engineStderr', line));
    this.info = await detectEngine(this.engine);
    this.adapter = this.info.kind === 'rapfi' ? rapfi : this.info.kind === 'classic' ? gomocup : null;
    if (this.adapter) {
      this.session = new SearchSession(this.engine, this.adapter, this.graceMs ? { graceMs: this.graceMs } : {});
      this.session.on('info', (data) => this._forwardInfo(data));
    }
    this.emit('status', `engine: ${this.info.name} ${this.info.version} (${this.info.kind})`);
    this._connect();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    if (this.ws) this.ws.terminate();
    await this.engine.stop();
  }

  _connect() {
    if (this.stopped || this.fatal) return;
    const ws = new WebSocket(this.serverUrl, { maxPayload: P.MAX_MESSAGE_BYTES });
    this.ws = ws;
    ws.on('open', () => {
      this.backoff = this.reconnectMs;
      this._send({
        type: 'hello', token: this.token,
        engine: { name: this.info.name, version: this.info.version, kind: this.info.kind },
        limits: this.info.limits,
      });
      this.emit('status', 'connected to server');
    });
    ws.on('message', (data) => this._onMessage(ws, data));
    ws.on('error', () => {}); // the close event follows
    ws.on('close', (code) => {
      if (this.ws === ws) this.ws = null;
      this.gen++; // whatever the engine is computing belongs to a connection that is gone
      this.cfg = null;
      if (this.session) this.session.abort();
      if (FATAL_CLOSE[code]) {
        this.fatal = FATAL_CLOSE[code];
        this.emit('fatal', this.fatal);
        return;
      }
      if (this.stopped) return;
      this.emit('status', 'disconnected, retrying');
      this.retryTimer = setTimeout(() => this._connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    });
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  _forwardInfo(data) {
    const t = Date.now();
    if (t - this.lastInfoAt < INFO_INTERVAL_MS) return;
    this.lastInfoAt = t;
    this._send({ type: 'info', data });
  }

  async _onMessage(ws, raw) {
    const parsed = P.parseServerMessage(raw);
    if (!parsed.ok || ws !== this.ws) return;
    const { msg } = parsed;
    try {
      if (msg.type === 'config') await this._onConfig(ws, msg);
      else if (msg.type === 'go') await this._onGo(ws, msg);
      else if (msg.type === 'stop' || msg.type === 'gameOver') { this.gen++; if (this.session) await this.session.abort(); }
    } catch (err) {
      this._send({ type: 'log', level: 'error', text: String(err.message || err).slice(0, 500) });
    }
  }

  async _onConfig(ws, cfg) {
    this.gen++;
    this.cfg = null;
    if (this.session) await this.session.abort();
    const refuse = ({ reason, code, args }) => this._send({ type: 'ready', ok: false, reason: reason.slice(0, 300), code, args });
    const check = checkConfig(this.info.kind, cfg);
    if (!check.ok) return refuse(check);
    const probe = await probeConfigure(this.engine, this.adapter, cfg);
    if (!probe.ok) return refuse(probe);
    if (ws !== this.ws) return undefined;
    this.session.configure(cfg, { send: false });
    this.cfg = cfg;
    return this._send({ type: 'ready', ok: true });
  }

  async _onGo(ws, go) {
    if (!this.cfg) return; // not ready: the server only sends `go` after our ready
    this.gen++;
    const gen = this.gen;
    if (this.session.state !== 'idle') await this.session.abort();
    const { w, h } = this.cfg;
    const turnMs = go.turnMs > 0 ? Math.max(1, go.turnMs - this.marginMs) : 0;
    const timeLeftMs = Math.max(1, go.timeLeftMs - this.marginMs);
    const move = await this.session.search({ stones: go.stones, toMove: go.toMove, timeLeftMs, turnMs, w, h });
    if (!move || gen !== this.gen || ws !== this.ws) return; // aborted, superseded, or the connection died
    this._send({ type: 'move', gameId: go.gameId, ply: go.ply, x: move.x, y: move.y });
  }
}

module.exports = { Agent };
