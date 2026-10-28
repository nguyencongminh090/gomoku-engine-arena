const crypto = require('node:crypto');
const { parseOpenings } = require('./openings');
const { buildSchedule } = require('./schedule');

const RULES = ['freestyle', 'standard', 'caro'];
const MAX_GAMES = 200;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url'); // 192 bits for secrets
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// `detail` is a stable code the UI translates; `line` locates an opening error.
function badConfig(message, detail, line) {
  const err = new Error(message);
  err.code = 'badConfig';
  err.detail = detail;
  if (line !== undefined) err.line = line;
  return err;
}

// Validates a room config and returns it with defaults applied plus the game schedule.
function normalizeConfig(cfg) {
  if (cfg === null || typeof cfg !== 'object') throw badConfig('config must be an object', 'config');
  const out = {
    rule: cfg.rule, w: cfg.w, h: cfg.h, games: cfg.games,
    matchMs: cfg.matchMs, turnMs: cfg.turnMs,
    reconnectSec: cfg.reconnectSec === undefined ? 60 : cfg.reconnectSec,
    openingsText: cfg.openingsText,
  };
  if (!RULES.includes(out.rule)) throw badConfig('unknown rule', 'rule');
  if (!intIn(out.w, 5, 22) || !intIn(out.h, 5, 22)) throw badConfig('board sides must be integers in 5..22', 'size');
  if (!intIn(out.games, 1, MAX_GAMES)) throw badConfig(`games must be an integer in 1..${MAX_GAMES}`, 'games');
  if (!intIn(out.matchMs, 1, 24 * 3600e3)) throw badConfig('matchMs must be a positive integer', 'matchMs');
  if (!intIn(out.turnMs, 0, 24 * 3600e3)) throw badConfig('turnMs must be a non-negative integer', 'turnMs');
  if (!intIn(out.reconnectSec, 1, 3600)) throw badConfig('reconnectSec must be an integer in 1..3600', 'reconnect');
  if (typeof out.openingsText !== 'string' || out.openingsText.length > 20000) throw badConfig('openingsText must be a string', 'openingsType');
  let schedule;
  try {
    schedule = buildSchedule(parseOpenings(out.openingsText, out.w, out.h, out.rule), out.games);
  } catch (e) {
    if (e.code) throw badConfig(`openings: ${e.message}`, e.code, e.line);
    throw e;
  }
  return { cfg: out, schedule };
}

class RoomRegistry {
  constructor({ db, now = Date.now, maxPerIp = 5, ttlMs = 24 * 3600e3 }) {
    this.db = db;
    this.now = now;
    this.maxPerIp = maxPerIp;
    this.ttlMs = ttlMs;
    this.rooms = new Map();
    for (const row of db.allRooms()) {
      this.rooms.set(row.id, { ...row, schedule: normalizeConfig(row.cfg).schedule });
    }
  }

  _live(room) {
    return room && this.now() - room.lastActive <= this.ttlMs ? room : null;
  }

  create(ip, rawCfg) {
    const { cfg, schedule } = normalizeConfig(rawCfg);
    this.sweep();
    let open = 0;
    for (const r of this.rooms.values()) if (r.ip === ip) open++;
    if (open >= this.maxPerIp) {
      const err = new Error('too many open rooms from this address');
      err.code = 'ipLimit';
      throw err;
    }
    const id = randomToken(9);
    const tokenA = `${id}.${randomToken()}`;
    const tokenB = `${id}.${randomToken()}`;
    const creatorSecret = randomToken();
    const room = {
      id, ip, cfg, schedule,
      hashA: sha256(tokenA).toString('hex'), hashB: sha256(tokenB).toString('hex'),
      hashSecret: sha256(creatorSecret).toString('hex'),
      viewId: randomToken(12), createdAt: this.now(), lastActive: this.now(),
    };
    this.db.insertRoom(room);
    this.rooms.set(room.id, room);
    return { roomId: room.id, tokenA, tokenB, viewId: room.viewId, creatorSecret };
  }

  get(roomId) {
    return this._live(this.rooms.get(roomId)) || null;
  }

  getByViewId(viewId) {
    for (const r of this.rooms.values()) if (r.viewId === viewId) return this._live(r);
    return null;
  }

  // Constant-time comparison of token hashes; both are always compared.
  authenticate(roomId, token) {
    const room = this.get(roomId);
    if (!room || typeof token !== 'string') return null;
    const h = sha256(token);
    const isA = crypto.timingSafeEqual(h, Buffer.from(room.hashA, 'hex'));
    const isB = crypto.timingSafeEqual(h, Buffer.from(room.hashB, 'hex'));
    return isA ? 'A' : isB ? 'B' : null;
  }

  // Tokens are '<roomId>.<secret>' so an agent can connect with the token alone.
  resolveToken(token) {
    if (typeof token !== 'string') return null;
    const dot = token.indexOf('.');
    if (dot < 1) return null;
    const roomId = token.slice(0, dot);
    const player = this.authenticate(roomId, token);
    return player ? { roomId, player } : null;
  }

  delete(roomId, creatorSecret) {
    const room = this.get(roomId);
    if (!room || typeof creatorSecret !== 'string') return false;
    if (!crypto.timingSafeEqual(sha256(creatorSecret), Buffer.from(room.hashSecret, 'hex'))) return false;
    this.rooms.delete(roomId);
    this.db.deleteRoom(roomId);
    return true;
  }

  touch(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.lastActive = this.now();
    this.db.touchRoom(roomId, room.lastActive);
  }

  sweep() {
    let removed = 0;
    for (const [id, room] of this.rooms) {
      if (!this._live(room)) {
        this.rooms.delete(id);
        this.db.deleteRoom(id);
        removed++;
      }
    }
    return removed;
  }
}

module.exports = { RoomRegistry, normalizeConfig };
